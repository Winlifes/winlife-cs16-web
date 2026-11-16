package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type settlementTransport func(*http.Request) (*http.Response, error)

func (f settlementTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func settlementWorker(m *roomLobby, id string, handler http.HandlerFunc) {
	m.mu.Lock()
	m.rooms[id].Phase = "playing"
	m.mu.Unlock()
	m.http.Transport = settlementTransport(func(r *http.Request) (*http.Response, error) {
		w := httptest.NewRecorder()
		handler(w, r)
		return w.Result(), nil
	})
}

func settlementGuest(t *testing.T, s *httptest.Server, host joinedRoom) joinedRoom {
	t.Helper()
	status, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Guest"})
	var guest joinedRoom
	if status != 200 || json.Unmarshal(data, &guest) != nil {
		t.Fatalf("join guest: %d %s", status, data)
	}
	return guest
}

func TestHostExitClosesOnlyFinishedMatch(t *testing.T) {
	for _, phase := range []string{"finished", "warmup", "starting", "live", "halftime"} {
		t.Run(phase, func(t *testing.T) {
			m, s := testLobby(t, 2)
			host := createTestRoom(t, s, "Host", 4)
			guest := settlementGuest(t, s, host)
			other := createTestRoom(t, s, "Other", 2)
			settlementWorker(m, host.Room.ID, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/match" {
					t.Error("wrong worker request", r.Method, r.URL.Path)
				}
				writeJSON(w, map[string]string{"phase": phase})
			})
			dir := filepath.Join(m.root, host.Room.ID)
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			status, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", host.Token, nil)
			var result struct{ Left, Closed bool }
			if status != 200 || json.Unmarshal(data, &result) != nil || !result.Left || result.Closed != (phase == "finished") {
				t.Fatalf("exit: %d %s", status, data)
			}
			m.mu.Lock()
			room, otherRoom := m.rooms[host.Room.ID], m.rooms[other.Room.ID]
			m.mu.Unlock()
			if otherRoom == nil {
				t.Fatal("unrelated room was closed")
			}
			if phase == "finished" {
				if room != nil {
					t.Fatal("finished room survived host exit")
				}
				if _, err := os.Stat(dir); !os.IsNotExist(err) {
					t.Fatal("room files not reclaimed", err)
				}
				for _, action := range []string{"", "/match", "/rematch", "/join"} {
					code, _ := roomRequest(t, s, "/rooms/"+host.Room.ID+action, "POST", guest.Token, map[string]string{"nickname": "Guest"})
					if code != 404 {
						t.Fatal("closed room still accessible", action, code)
					}
				}
				createTestRoom(t, s, "Reused", 2) // The room slot is immediately reusable.
			} else if room == nil || room.HostID != guest.MemberID || len(room.members) != 1 {
				t.Fatal("in-progress room did not transfer to guest")
			}
		})
	}
}

func TestGuestExitAtSettlementKeepsHostAndRoom(t *testing.T) {
	m, s := testLobby(t, 1)
	host := createTestRoom(t, s, "Host", 4)
	guest := settlementGuest(t, s, host)
	settlementWorker(m, host.Room.ID, func(w http.ResponseWriter, r *http.Request) { t.Error("guest exit queried match state") })
	code, data := roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", guest.Token, nil)
	if code != 200 || !strings.Contains(string(data), `"closed":false`) {
		t.Fatal(code, string(data))
	}
	code, data = roomRequest(t, s, "/rooms/"+host.Room.ID, "GET", host.Token, nil)
	var room roomView
	if code != 200 || json.Unmarshal(data, &room) != nil || room.HostID != host.MemberID || len(room.Members) != 1 {
		t.Fatal("host room lost", code, string(data))
	}
}

func TestHostExitDoesNotTrustUnavailableOrInvalidMatchState(t *testing.T) {
	for _, response := range []string{"unavailable", `{}`, `{"phase":"unknown"}`, `not-json`} {
		t.Run(response, func(t *testing.T) {
			m, s := testLobby(t, 1)
			host := createTestRoom(t, s, "Host", 4)
			settlementGuest(t, s, host)
			settlementWorker(m, host.Room.ID, func(w http.ResponseWriter, r *http.Request) {
				if response == "unavailable" {
					w.WriteHeader(503)
					return
				}
				io.WriteString(w, response)
			})
			code, _ := roomRequest(t, s, "/rooms/"+host.Room.ID+"/leave", "POST", host.Token, nil)
			if code != 503 {
				t.Fatal("unconfirmed state accepted", code)
			}
			m.mu.Lock()
			room := m.rooms[host.Room.ID]
			if room == nil || room.HostID != host.MemberID || len(room.members) != 2 {
				t.Error("uncertain exit changed room")
			}
			m.mu.Unlock()
		})
	}
}

func TestSettlementExitSerializesWithRematchWithoutBlockingLobby(t *testing.T) {
	m, s := testLobby(t, 2)
	host := createTestRoom(t, s, "Host", 4)
	settlementGuest(t, s, host)
	entered, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	var restarts atomic.Int32
	settlementWorker(m, host.Room.ID, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/match" {
			close(entered)
			<-release
			writeJSON(w, map[string]string{"phase": "finished"})
			return
		}
		restarts.Add(1)
		writeJSON(w, map[string]string{"phase": "starting"})
	})
	status := make(chan int, 2)
	request := func(action string) {
		req, _ := http.NewRequest("POST", s.URL+"/rooms/"+host.Room.ID+action, strings.NewReader("{}"))
		req.Header.Set("X-CS16-Session", host.Token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			status <- 0
			return
		}
		res.Body.Close()
		status <- res.StatusCode
	}
	go request("/leave")
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("host exit did not query worker")
	}
	go request("/rematch")
	// Listing and unrelated rooms still work while this room awaits its worker.
	createTestRoom(t, s, "Other", 2)
	close(release)
	first, second := <-status, <-status
	if first+second != 200+404 || restarts.Load() != 0 {
		t.Fatal("restart raced room destruction", first, second, restarts.Load())
	}
}

func TestRematchThenHostExitPreservesNewMatch(t *testing.T) {
	m, s := testLobby(t, 1)
	host := createTestRoom(t, s, "Host", 4)
	guest := settlementGuest(t, s, host)
	var restarted atomic.Bool
	settlementWorker(m, host.Room.ID, func(w http.ResponseWriter, r *http.Request) {
		phase := "finished"
		if r.URL.Path == "/match/restart" {
			restarted.Store(true)
		}
		if restarted.Load() {
			phase = "starting"
		}
		writeJSON(w, map[string]string{"phase": phase})
	})
	for _, action := range []string{"/rematch", "/leave"} {
		if code, data := roomRequest(t, s, "/rooms/"+host.Room.ID+action, "POST", host.Token, nil); code != 200 {
			t.Fatal(code, string(data))
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	room := m.rooms[host.Room.ID]
	if room == nil || room.HostID != guest.MemberID {
		t.Fatal("new match was dissolved")
	}
}
