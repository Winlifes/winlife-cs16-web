package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func beginDeathmatch(t *testing.T, m *matchController, now time.Time) {
	t.Helper()
	const tJoin = `"Alice<1><STEAM_ID_LAN><>" joined team "TERRORIST"`
	const ctJoin = `"Bob<2><STEAM_ID_LAN><>" joined team "CT"`
	if commands := m.consume(nativeEvent(tJoin), now); len(commands) != 0 {
		t.Fatal("one team started a match", commands)
	}
	if commands := m.consume(nativeEvent(ctJoin), now); !reflect.DeepEqual(commands, []string{"sv_restart 1"}) {
		t.Fatal("both teams did not start a match", commands)
	}
	m.consume(nativeEvent(`World triggered "Restart_Round_(1_second)"`), now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
}

func TestDeathmatchScoresEnemyKillsAndRematches(t *testing.T) {
	m := newRoomMatch(deathmatchMode)
	now := time.Now()
	const kill = `"Alice<1><STEAM_ID_LAN><TERRORIST>" killed "Bob<2><STEAM_ID_LAN><CT>" with "ak47"`
	m.consume(nativeEvent(kill), now)
	if m.snapshot().ScoreA != 0 {
		t.Fatal("counted warmup kill")
	}
	beginDeathmatch(t, m, now)
	state := m.snapshot()
	if state.Phase != "live" || state.EndsAt != now.Add(deathmatchDuration).UnixMilli() {
		t.Fatal(state)
	}
	for _, event := range []string{
		`"Alice<1><STEAM_ID_LAN><TERRORIST>" killed "Friend<3><STEAM_ID_LAN><TERRORIST>" with "ak47"`,
		`"Alice<1><STEAM_ID_LAN><TERRORIST>" committed suicide with "world"`,
		`Team "TERRORIST" triggered "Terrorists_Win" (CT "0") (T "1")`,
	} {
		m.consume(nativeEvent(event), now)
	}
	if m.snapshot().ScoreA != 0 {
		t.Fatal("counted non-enemy event")
	}
	for i := 1; i < deathmatchTarget; i++ {
		if commands := m.consume(nativeEvent(kill), now); len(commands) != 0 {
			t.Fatal(commands)
		}
	}
	commands := m.consume(nativeEvent(kill), now)
	state = m.snapshot()
	if !reflect.DeepEqual(commands, []string{"winlife_pause 1"}) || state.Phase != "finished" || state.Winner != "A" || state.ScoreA != deathmatchTarget || state.Swapped {
		t.Fatal(state, commands)
	}
	if next, ok := m.restart(); !ok || !reflect.DeepEqual(next, []string{"winlife_pause 0", "exec winlife_mode.cfg", "sv_restart 1"}) || m.snapshot().Mode != deathmatchMode || m.snapshot().ScoreA != 0 {
		t.Fatal(m.snapshot(), next)
	}
}

func TestDeathmatchTimeLimitAndDuelTarget(t *testing.T) {
	now := time.Now()
	dm := newRoomMatch(deathmatchMode)
	beginDeathmatch(t, dm, now)
	dm.consume(nativeEvent(`"Bob<2><STEAM_ID_LAN><CT>" killed "Alice<1><STEAM_ID_LAN><TERRORIST>" with "m4a1"`), now)
	if commands := dm.tick(now.Add(deathmatchDuration)); len(commands) != 1 || dm.snapshot().Winner != "B" {
		t.Fatal(dm.snapshot(), commands)
	}
	duel := newRoomMatch(duelMode)
	beginMatch(duel, now)
	for i := 1; i < 7; i++ {
		if commands := win(duel, "TERRORIST", 0, i, now); len(commands) != 0 {
			t.Fatal(commands)
		}
	}
	win(duel, "TERRORIST", 0, 7, now)
	if s := duel.snapshot(); s.Mode != duelMode || s.Phase != "finished" || s.Target != 7 || s.ScoreA != 7 || s.Swapped {
		t.Fatal(s)
	}
}

func TestRoomCatalogRequiresAssetsAndKnownMode(t *testing.T) {
	game, public := t.TempDir(), t.TempDir()
	mapsDir := filepath.Join(game, "cstrike", "maps")
	if err := os.MkdirAll(mapsDir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"de_dust2", "de_nuke"} {
		if err := os.WriteFile(filepath.Join(mapsDir, name+".bsp"), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(public, "assets-manifest.json"), []byte(`{"maps":["de_nuke","de_train"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	m, server := testLobby(t, 2)
	m.maps = installedMaps(game, public)
	if len(m.maps) != 1 || m.maps[0].ID != "de_nuke" {
		t.Fatal(m.maps)
	}
	payload := map[string]any{"nickname": "Host", "name": "Room", "map": "de_nuke", "maxPlayers": 4, "mode": "quick"}
	if status, _ := roomRequest(t, server, "/rooms", "POST", "", payload); status != 400 {
		t.Fatal("accepted unknown mode")
	}
	payload["mode"] = deathmatchMode
	status, data := roomRequest(t, server, "/rooms", "POST", "", payload)
	var result joinedRoom
	if status != 200 || json.Unmarshal(data, &result) != nil || result.Room.Mode != deathmatchMode {
		t.Fatal(status, string(data))
	}
}

func TestDuelRequiresArenaAndCapsRoomAtTwo(t *testing.T) {
	_, server := testLobby(t, 2)
	payload := map[string]any{"nickname": "Host", "name": "Duel", "map": "de_dust2", "maxPlayers": 16, "mode": duelMode}
	if status, _ := roomRequest(t, server, "/rooms", "POST", "", payload); status != 400 {
		t.Fatal("regular map accepted in duel mode")
	}
	payload["map"] = "wl_duel_yard"
	status, data := roomRequest(t, server, "/rooms", "POST", "", payload)
	var result joinedRoom
	if status != 200 || json.Unmarshal(data, &result) != nil || result.Room.MaxPlayers != 2 || result.Room.Mode != duelMode {
		t.Fatal(status, string(data))
	}
}
