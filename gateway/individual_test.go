package main

import (
	"reflect"
	"testing"
	"time"
)

const (
	aliceJoinsIndividual = `"Alice<1><ID_LAN><>" joined team "TERRORIST"`
	bobJoinsIndividual   = `"Bob<2><ID_LAN><>" joined team "TERRORIST"`
	aliceKillsBob        = `"Alice<1><ID_LAN><TERRORIST>" killed "Bob<2><ID_LAN><TERRORIST>" with "ak47"`
	bobKillsAlice        = `"Bob<2><ID_LAN><TERRORIST>" killed "Alice<1><ID_LAN><TERRORIST>" with "ak47"`
)

func beginIndividual(t *testing.T, now time.Time) *matchController {
	t.Helper()
	m := newRoomMatch(individualMode)
	m.consume(nativeEvent(aliceJoinsIndividual), now)
	m.consume(nativeEvent(`"Observer<3><ID_LAN><>" joined team "SPECTATOR"`), now)
	m.consume(nativeEvent(aliceKillsBob), now)
	if s := m.snapshot(); s.Phase != "warmup" || len(s.Players) != 1 || s.Players[0].Kills != 0 {
		t.Fatal(s)
	}
	if got := m.consume(nativeEvent(bobJoinsIndividual), now); !reflect.DeepEqual(got, []string{"sv_restart 1"}) {
		t.Fatal(got)
	}
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	if s := m.snapshot(); s.Phase != "live" || s.EndsAt != now.Add(deathmatchDuration).UnixMilli() {
		t.Fatal(s)
	}
	return m
}

func TestIndividualScoresSameTeamKillsAndRematches(t *testing.T) {
	now := time.Now()
	m := beginIndividual(t, now)
	m.consume(nativeEvent(`"Bob<2><ID_LAN><TERRORIST>" committed suicide with "world"`), now)
	for i := 1; i < deathmatchTarget; i++ {
		if commands := m.consume(nativeEvent(aliceKillsBob), now); len(commands) != 0 {
			t.Fatal(commands)
		}
	}
	m.consume(nativeEvent(`World triggered "Game_Commencing"`), now)
	commands := m.consume(nativeEvent(aliceKillsBob), now)
	s := m.snapshot()
	if s.Phase != "finished" || s.Winner != "individual" || !reflect.DeepEqual(commands, []string{"winlife_pause 1"}) {
		t.Fatal(s, commands)
	}
	if s.Players[0].Name != "Alice" || s.Players[0].Kills != deathmatchTarget || s.Players[1].Deaths != deathmatchTarget+1 {
		t.Fatal(s.Players)
	}
	m.consume(nativeEvent(bobKillsAlice), now)
	if !reflect.DeepEqual(m.snapshot().Players, s.Players) {
		t.Fatal("counted post-match kill")
	}
	if commands, ok := m.restart(); !ok || !reflect.DeepEqual(commands, []string{"winlife_pause 0", "exec winlife_mode.cfg", "sv_restart 1"}) {
		t.Fatal(commands, ok)
	}
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	s = m.snapshot()
	if s.Phase != "live" || len(s.Players) != 2 || s.Players[0].Kills != 0 || s.Players[1].Deaths != 0 {
		t.Fatal(s)
	}
}

func TestIndividualTimesOutWithTiedScores(t *testing.T) {
	now := time.Now()
	m := beginIndividual(t, now)
	m.consume(nativeEvent(aliceKillsBob), now)
	m.consume(nativeEvent(bobKillsAlice), now)
	m.consume(nativeEvent(`"Bob<2><ID_LAN><TERRORIST>" disconnected`), now)
	commands := m.tick(now.Add(deathmatchDuration))
	s := m.snapshot()
	if len(commands) != 1 || s.Phase != "finished" || s.Winner != "draw" || s.Players[0].Kills != 1 || s.Players[1].Kills != 1 || s.Players[1].Playing {
		t.Fatal(s, commands)
	}
}

func TestIndividualCatalogRequiresNativeFreeForAll(t *testing.T) {
	lobby, server := testLobby(t, 2)
	request := map[string]any{"nickname": "Host", "name": "Room", "map": "de_dust2", "maxPlayers": 4, "mode": individualMode}
	if code, _ := roomRequest(t, server, "/rooms", "POST", "", request); code != 400 {
		t.Fatal(code)
	}
	lobby.individual = true
	if code, _ := roomRequest(t, server, "/rooms", "POST", "", request); code != 200 {
		t.Fatal(code)
	}
}
