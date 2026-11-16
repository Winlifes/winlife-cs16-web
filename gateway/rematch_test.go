package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

func TestRematchRequiresRoomHostAndProxiesOnlyPrivateRestart(t *testing.T) {
	m, s := testLobby(t, 2)
	host := createTestRoom(t, s, "Host", 4)
	status, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Guest"})
	if status != 200 {
		t.Fatal(string(data))
	}
	var guest joinedRoom
	if err := json.Unmarshal(data, &guest); err != nil {
		t.Fatal(err)
	}
	calls := 0
	m.token = "server-private-token"
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/match/restart" || r.Header.Get("X-CS16-Admin") != m.token || r.Header.Get("X-CS16-Session") != "" {
			t.Errorf("unexpected private request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(w, map[string]string{"phase": "starting"})
	}))
	defer worker.Close()
	u, _ := url.Parse(worker.URL)
	port, _ := strconv.Atoi(u.Port())
	m.mu.Lock()
	room := m.rooms[host.Room.ID]
	room.Phase = "playing"
	room.workerPort = port - 1
	m.mu.Unlock()
	route := fmt.Sprintf("/rooms/%s/rematch", host.Room.ID)
	for _, tc := range []struct {
		token, method string
		status        int
	}{{guest.Token, "POST", 403}, {"", "POST", 403}, {host.Token, "GET", 405}, {host.Token, "POST", 200}} {
		code, body := roomRequest(t, s, route, tc.method, tc.token, nil)
		if code != tc.status {
			t.Fatalf("status %d, want %d: %s", code, tc.status, body)
		}
	}
	if calls != 1 {
		t.Fatal("unauthorized restart reached worker", calls)
	}
}
