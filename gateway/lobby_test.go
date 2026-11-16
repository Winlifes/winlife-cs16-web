package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type joinedRoom struct {
	Room     roomView `json:"room"`
	MemberID string   `json:"memberId"`
	Token    string   `json:"token"`
}

func testLobby(t *testing.T, limit int) (*roomLobby, *httptest.Server) {
	t.Helper()
	m := &roomLobby{rooms: map[string]*gameRoom{}, slots: map[int]bool{}, maxRooms: limit, root: t.TempDir(), http: &http.Client{Timeout: time.Second}}
	s := httptest.NewServer(m.handler())
	t.Cleanup(s.Close)
	return m, s
}
func roomRequest(t *testing.T, server *httptest.Server, route, method, token string, body any) (int, []byte) {
	t.Helper()
	data, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, server.URL+route, bytes.NewReader(data))
	if token != "" {
		req.Header.Set("X-CS16-Session", token)
	}
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	var raw json.RawMessage
	if e = json.NewDecoder(res.Body).Decode(&raw); e != nil {
		t.Fatal(e)
	}
	return res.StatusCode, raw
}
func createTestRoom(t *testing.T, server *httptest.Server, name string, max int) joinedRoom {
	t.Helper()
	status, data := roomRequest(t, server, "/rooms", "POST", "", map[string]any{"nickname": name, "name": name + " room", "map": "de_dust2", "maxPlayers": max})
	if status != 200 {
		t.Fatalf("create: %s", data)
	}
	var joined joinedRoom
	_ = json.Unmarshal(data, &joined)
	return joined
}
func TestLobbyCapacityHostTransferAndLateJoin(t *testing.T) {
	m, s := testLobby(t, 2)
	host := createTestRoom(t, s, "Host", 2)
	status, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Guest"})
	if status != 200 {
		t.Fatal(string(data))
	}
	var guest joinedRoom
	_ = json.Unmarshal(data, &guest)
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/start", "POST", guest.Token, nil)
	if status != 403 {
		t.Fatal("guest may not start")
	}
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Overflow"})
	if status != 409 {
		t.Fatal("capacity not enforced")
	}
	status, data = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", guest.Token, map[string]string{"nickname": "Guest"})
	if status != 200 {
		t.Fatal("rejoin must be idempotent")
	}
	status, _ = roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", host.Token, nil)
	if status != 200 {
		t.Fatal(status)
	}
	m.mu.Lock()
	r := m.rooms[host.Room.ID]
	if r.HostID != guest.MemberID {
		t.Error("host not transferred")
	}
	r.Phase = "playing"
	m.mu.Unlock()
	status, data = roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Late"})
	if status != 200 {
		t.Fatalf("in-progress join blocked: %s", data)
	}
	var late joinedRoom
	_ = json.Unmarshal(data, &late)
	status, list := roomRequest(t, s, "/rooms", "GET", "", nil)
	if status != 200 || strings.Contains(string(list), guest.Token) || strings.Contains(string(list), late.Token) {
		t.Fatal("private session exposed")
	}
	roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", guest.Token, nil)
	roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", late.Token, nil)
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.rooms) != 0 || len(m.slots) != 0 {
		t.Fatal("empty room not reclaimed")
	}
}
func TestLobbyConcurrentSeatReservation(t *testing.T) {
	_, s := testLobby(t, 1)
	host := createTestRoom(t, s, "Host", 16)
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 35; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			data, _ := json.Marshal(map[string]string{"nickname": fmt.Sprintf("Guest%d", i)})
			res, e := http.Post(s.URL+"/rooms/"+host.Room.ID+"/join", "application/json", bytes.NewReader(data))
			if e == nil {
				res.Body.Close()
				if res.StatusCode == 200 {
					accepted.Add(1)
				}
			}
		}(i)
	}
	wg.Wait()
	if accepted.Load() != 15 {
		t.Fatalf("reserved %d instead of 15 seats", accepted.Load())
	}
	status, _ := roomRequest(t, s, "/rooms", "POST", "", map[string]any{"nickname": "Second", "name": "Second room", "map": "de_dust2", "maxPlayers": 2})
	if status != 409 {
		t.Fatal("room limit exceeded")
	}
}
func TestLobbyExpirationPreservesActiveConnections(t *testing.T) {
	m, s := testLobby(t, 1)
	host := createTestRoom(t, s, "Host", 2)
	m.mu.Lock()
	r := m.rooms[host.Room.ID]
	p := r.members[host.MemberID]
	p.seen = time.Now().Add(-10 * time.Minute)
	p.connections = 1
	m.mu.Unlock()
	m.reap(time.Now())
	m.mu.Lock()
	if len(r.members) != 1 {
		t.Error("connected browser expired")
	}
	p.connections = 0
	m.mu.Unlock()
	m.reap(time.Now())
	m.mu.Lock()
	if len(r.members) != 0 {
		t.Error("abandoned member retained")
	}
	r.emptySince = time.Now().Add(-100 * time.Second)
	m.mu.Unlock()
	m.reap(time.Now())
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.rooms) != 0 {
		t.Error("abandoned room retained")
	}
}
func TestLobbyRoomRoutingIsolatesGameAndMatch(t *testing.T) {
	m, s := testLobby(t, 2)
	a := createTestRoom(t, s, "A", 4)
	b := createTestRoom(t, s, "B", 4)
	for _, room := range []joinedRoom{a, b} {
		name := room.Room.Name
		backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/match" {
				writeJSON(w, map[string]string{"room": name})
				return
			}
			ws, e := (&websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}).Upgrade(w, r, nil)
			if e != nil {
				return
			}
			defer ws.Close()
			kind, data, e := ws.ReadMessage()
			if e == nil {
				ws.WriteMessage(kind, append([]byte(name+":"), data...))
			}
		}))
		t.Cleanup(backend.Close)
		uri, _ := url.Parse(backend.URL)
		port, _ := strconv.Atoi(uri.Port())
		m.mu.Lock()
		m.rooms[room.Room.ID].Phase = "playing"
		m.rooms[room.Room.ID].workerPort = port
		m.mu.Unlock()
	}
	for _, room := range []joinedRoom{a, b} {
		status, match := roomRequest(t, s, "/rooms/"+room.Room.ID+"/match", "GET", "", nil)
		if status != 200 || !strings.Contains(string(match), room.Room.Name) {
			t.Fatal("match routed to wrong room")
		}
		ws, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(s.URL, "http")+"/rooms/"+room.Room.ID+"/datagram?session="+room.Token, nil)
		if e != nil {
			t.Fatal(e)
		}
		ws.SetReadDeadline(time.Now().Add(time.Second))
		ws.WriteMessage(websocket.BinaryMessage, []byte("packet"))
		_, reply, e := ws.ReadMessage()
		ws.Close()
		if e != nil || string(reply) != room.Room.Name+":packet" {
			t.Fatal("game datagram routed to wrong room")
		}
	}
	ws, res, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(s.URL, "http")+"/rooms/"+a.Room.ID+"/datagram?session="+b.Token, nil)
	if ws != nil {
		ws.Close()
	}
	if e == nil || res.StatusCode != 403 {
		t.Fatal("cross-room session accepted")
	}
}

func TestRoomFilesKeepConfigurationAndCachesPrivate(t *testing.T) {
	source := t.TempDir()
	destination := filepath.Join(t.TempDir(), "game")
	state := filepath.Join(source, ".rooms")
	for _, dir := range []string{"cstrike/maps", "cstrike/logs", "cstrike/addons/yapb", ".rooms/old"} {
		if err := os.MkdirAll(filepath.Join(source, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for path, data := range map[string]string{"cstrike/server.cfg": "money 800", "cstrike/maps/test.bsp": "map media", "cstrike/addons/yapb/test.graph": "cache", "cstrike/logs/old.log": "old log", ".rooms/old/marker": "private"} {
		if err := os.WriteFile(filepath.Join(source, path), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := cloneRoomGame(source, destination, state); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"cstrike/server.cfg", "cstrike/addons/yapb/test.graph"} {
		os.WriteFile(filepath.Join(destination, path), []byte("changed"), 0600)
		original, _ := os.ReadFile(filepath.Join(source, path))
		if string(original) == "changed" {
			t.Fatalf("%s leaked to shared data", path)
		}
	}
	for _, path := range []string{".rooms/old/marker", "cstrike/logs/old.log"} {
		if _, err := os.Stat(filepath.Join(destination, path)); !os.IsNotExist(err) {
			t.Fatalf("inherited private %s", path)
		}
	}
	media, err := os.ReadFile(filepath.Join(destination, "cstrike/maps/test.bsp"))
	if err != nil || string(media) != "map media" {
		t.Fatal("map assets missing")
	}
}
