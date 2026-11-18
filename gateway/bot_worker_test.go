package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManualBotTeamsRespectHostAndHumanSeats(t *testing.T) {
	m, server := testLobby(t, 1)
	host := createTestRoom(t, server, "Host", 4)
	route := "/rooms/" + host.Room.ID + "/bots"
	for _, body := range []any{
		map[string]any{"split": true, "t": 1, "difficulty": 2},
		botSettings{Split: true, T: -1, CT: 2, Count: 1, Difficulty: 2},
		botSettings{Split: true, T: 2, CT: 1, Count: 2, Difficulty: 2},
		botSettings{Split: true, T: 16, Count: 16, Difficulty: 2},
	} {
		if status, _ := roomRequest(t, server, route, "POST", host.Token, body); status != 400 {
			t.Fatalf("invalid manual teams accepted: %d", status)
		}
	}
	if status, _ := roomRequest(t, server, route, "POST", host.Token, botSettings{Split: true, T: 1, CT: 3, Count: 4, Difficulty: 2}); status != 409 {
		t.Fatal("manual teams exceeded seats")
	}
	if status, data := roomRequest(t, server, route, "POST", host.Token, botSettings{Split: true, T: 0, CT: 3, Count: 3, Difficulty: 2}); status != 200 {
		t.Fatal(status, string(data))
	}
	if status, _ := roomRequest(t, server, "/rooms/"+host.Room.ID+"/join", "POST", "", map[string]string{"nickname": "Guest"}); status != 200 {
		t.Fatal(status)
	}
	m.mu.Lock()
	settings := m.rooms[host.Room.ID].Bots
	m.mu.Unlock()
	if !settings.Split || settings.T != 0 || settings.CT != 2 || settings.Count != 2 {
		t.Fatalf("human admission lost chosen sides: %+v", settings)
	}
}

func TestWorkerBotTeamsPersistSwapAndRejectStaleRetries(t *testing.T) {
	game := t.TempDir()
	os.MkdirAll(filepath.Join(game, "cstrike"), 0700)
	var commands []string
	fail := false
	b := newBotController(game, func(command string) error {
		if fail {
			return errors.New("engine unavailable")
		}
		commands = append(commands, command)
		return nil
	})
	update := botWorkerUpdate{Settings: botSettings{Split: true, T: 1, CT: 3, Count: 4, Difficulty: 4}, Revision: 1}
	if err := b.apply(update); err != nil {
		t.Fatal(err)
	}
	if err := b.swapTeams(); err != nil {
		t.Fatal(err)
	}
	if err := b.apply(update); err != nil {
		t.Fatal(err)
	}
	if got := b.snapshot(); got.Settings.T != 3 || got.Settings.CT != 1 || len(commands) != 2 {
		t.Fatalf("stale retry reversed halftime: %+v %v", got, commands)
	}
	config, _ := os.ReadFile(filepath.Join(game, "cstrike/winlife_bots.cfg"))
	if !strings.Contains(string(config), "yb_winlife_quota_t 3\nyb_winlife_quota_ct 1\n") {
		t.Fatal(string(config))
	}
	half, _ := os.ReadFile(filepath.Join(game, "cstrike/winlife_bot_halftime.cfg"))
	if string(half) != "exec winlife_bots.cfg\nswapteams 1\n" || commands[1] != "exec winlife_bot_halftime.cfg" {
		t.Fatal("quotas and swap not applied in one native buffer")
	}
	update.Revision = 2
	update.Settings = botSettings{Count: 2, Difficulty: 1}
	fail = true
	if b.apply(update) == nil || b.snapshot().Revision != 1 {
		t.Fatal("failed update incorrectly acknowledged")
	}
	fail = false
	if err := b.apply(update); err != nil {
		t.Fatal(err)
	}
	config, _ = os.ReadFile(filepath.Join(game, "cstrike/winlife_bots.cfg"))
	if !strings.Contains(string(config), "yb_winlife_quota_t -1\nyb_winlife_quota_ct -1\n") {
		t.Fatal("auto mode did not release side quotas")
	}
	if err := b.swapTeams(); err != nil || commands[len(commands)-1] != "swapteams 1" {
		t.Fatal("automatic mode broke native swap")
	}
}
