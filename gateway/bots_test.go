package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestBotSettingsRequireRoomHostAndValidSeats(t *testing.T) {
	m, s := testLobby(t, 2)
	host := createTestRoom(t, s, "Host", 4)
	other := createTestRoom(t, s, "Other", 4)
	status, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Guest"})
	if status != 200 {
		t.Fatal(string(data))
	}
	var guest joinedRoom
	json.Unmarshal(data, &guest)
	route := "/rooms/" + host.Room.ID + "/bots"
	for _, token := range []string{"", guest.Token, other.Token} {
		status, _ = roomRequest(t, s, route, "POST", token, botSettings{Count: 2, Difficulty: 2})
		if status != 403 {
			t.Fatalf("non-host accepted: %d", status)
		}
	}
	for _, body := range []any{map[string]int{"count": 1}, botSettings{Count: -1, Difficulty: 2}, botSettings{Count: 1, Difficulty: 5}, map[string]any{"count": "1;quit", "difficulty": 2}} {
		status, _ = roomRequest(t, s, route, "POST", host.Token, body)
		if status != 400 {
			t.Fatalf("invalid settings accepted: %d", status)
		}
	}
	status, _ = roomRequest(t, s, route, "POST", host.Token, botSettings{Count: 3, Difficulty: 2})
	if status != 409 {
		t.Fatal("bots exceeded seats reserved for humans")
	}
	status, data = roomRequest(t, s, route, "POST", host.Token, botSettings{Count: 2, Difficulty: 4})
	var view roomView
	json.Unmarshal(data, &view)
	if status != 200 || view.Bots.Count != 2 || view.Bots.Difficulty != 4 {
		t.Fatalf("settings not saved: %s", data)
	}
	// Bots are not members: they must neither inherit hosting nor keep a room alive.
	roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", host.Token, nil)
	status, _ = roomRequest(t, s, route, "POST", guest.Token, botSettings{Count: 0, Difficulty: 1})
	if status != 200 {
		t.Fatal("new host could not clear bots")
	}
	roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", guest.Token, nil)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rooms[host.Room.ID] != nil {
		t.Fatal("bots kept empty room alive")
	}
}

func TestHumansDisplaceBotQuotaAtLogicalRoomCapacity(t *testing.T) {
	m, s := testLobby(t, 1)
	host := createTestRoom(t, s, "Host", 2)
	status, _ := roomRequest(t, s, "/rooms/"+host.Room.ID+"/bots", "POST", host.Token, botSettings{Count: 1, Difficulty: 2})
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Late"})
	if status != 200 {
		t.Fatal("bot blocked human admission")
	}
	m.mu.Lock()
	quota := m.rooms[host.Room.ID].Bots.Count
	m.mu.Unlock()
	if quota != 0 {
		t.Fatal("bot quota did not yield reserved seat")
	}
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Overflow"})
	if status != 409 {
		t.Fatal("logical human limit not enforced")
	}
	if nativeRoomCapacity(16) != 17 || nativeRoomCapacity(2) != 4 {
		t.Fatal("missing native admission slot")
	}
}

func TestBotConfigIsPrivatePersistsAndRetriesWorkerFailure(t *testing.T) {
	m, s := testLobby(t, 1)
	m.token = "private-worker-token"
	host := createTestRoom(t, s, "Host", 4)
	var unavailable atomic.Bool
	var commands atomic.Int32
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/console" || r.Header.Get("X-CS16-Admin") != m.token {
			t.Error("invalid private worker routing")
		}
		if unavailable.Load() {
			w.WriteHeader(503)
			return
		}
		var body struct{ Command string }
		json.NewDecoder(r.Body).Decode(&body)
		if body.Command != "exec winlife_bots.cfg" {
			t.Errorf("unexpected command: %q", body.Command)
		}
		commands.Add(1)
		writeJSON(w, map[string]bool{"accepted": true})
	}))
	defer worker.Close()
	u, _ := url.Parse(worker.URL)
	port, _ := strconv.Atoi(u.Port())
	m.mu.Lock()
	room := m.rooms[host.Room.ID]
	room.workerPort, room.Phase = port-1, "playing"
	m.mu.Unlock()
	game := filepath.Join(m.roomDir(room), "game")
	os.MkdirAll(filepath.Join(game, "cstrike"), 0700)
	route := "/rooms/" + host.Room.ID + "/bots"
	status, data := roomRequest(t, s, route, "POST", host.Token, botSettings{Count: 3, Difficulty: 3})
	if status != 200 || commands.Load() != 1 {
		t.Fatalf("worker not updated: %s", data)
	}
	config, _ := os.ReadFile(filepath.Join(game, "cstrike/winlife_bots.cfg"))
	if !strings.Contains(string(config), "yb_quota 3\n") || !strings.Contains(string(config), "yb_difficulty 3\n") || !strings.Contains(string(config), "yb_autovacate 1\n") {
		t.Fatal("invalid persistent bot config")
	}
	// A joining browser reserves a human seat even before its native client loads.
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Late"})
	if status != 200 {
		t.Fatal("late join failed")
	}
	config, _ = os.ReadFile(filepath.Join(game, "cstrike/winlife_bots.cfg"))
	if !strings.Contains(string(config), "yb_quota 2\n") {
		t.Fatal("live quota ignored loading member")
	}
	unavailable.Store(true)
	status, data = roomRequest(t, s, route, "POST", host.Token, botSettings{Count: 0, Difficulty: 1})
	var view roomView
	json.Unmarshal(data, &view)
	if status != 200 || view.BotsError == "" || view.Bots.Count != 0 {
		t.Fatal("worker failure was reported as applied")
	}
	unavailable.Store(false)
	if err := m.syncBots(room); err != nil {
		t.Fatal(err)
	}
	config, _ = os.ReadFile(filepath.Join(game, "cstrike/winlife_bots.cfg"))
	if !strings.HasSuffix(string(config), "yb kickall\n") {
		t.Fatal("clear command missing")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if room.botsDirty || room.BotsError != "" {
		t.Fatal("successful retry did not clear error")
	}
}
