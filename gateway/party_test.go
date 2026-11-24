package main

import (
	"reflect"
	"slices"
	"testing"
	"time"
)

func TestInfectionNativePhasesAndRematch(t *testing.T) {
	m := newRoomMatch(infectionMode)
	now := time.Now()
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	if m.snapshot().Phase != "warmup" {
		t.Fatal("a stock log changed the party phase")
	}
	m.consume(nativeEvent("WINLIFE_PARTY 1 prep 1 6 0"), now)
	if s := m.snapshot(); s.Phase != "preparing" || s.EndsAt != now.Add(6*time.Second).UnixMilli() {
		t.Fatal(s)
	}
	m.consume(nativeEvent("WINLIFE_PARTY 1 live 1 100 0"), now)
	cmd := m.consume(nativeEvent("WINLIFE_PARTY 1 finish 1 0 1"), now)
	if s := m.snapshot(); s.Phase != "finished" || s.Winner != "A" || s.ScoreA != 1 || !reflect.DeepEqual(cmd, []string{"winlife_pause 1"}) {
		t.Fatal(s, cmd)
	}
	if commands, ok := m.restart(); !ok || !reflect.DeepEqual(commands, []string{"winlife_pause 0", "winlife_party_reset"}) {
		t.Fatal(commands, ok)
	}
}

func TestHideAwardsPointsToTheSameGroupAfterRolesSwap(t *testing.T) {
	m := newRoomMatch(hideMode)
	now := time.Now()
	for _, event := range []string{
		"prep 1 20 0", "live 1 75 0", "between 1 4 2", "between 1 4 2", "prep 2 20 0", "live 2 75 0",
	} {
		m.consume(nativeEvent("WINLIFE_PARTY 1 "+event), now)
	}
	if s := m.snapshot(); !s.Swapped || s.Round != 2 || s.ScoreA != 0 || s.ScoreB != 1 {
		t.Fatal(s)
	}
	m.consume(nativeEvent("WINLIFE_PARTY 1 finish 2 0 1"), now)
	if s := m.snapshot(); s.Phase != "finished" || s.Winner != "B" || s.ScoreB != 2 {
		t.Fatal(s)
	}
}

func TestHideMapsAreOnlyAvailableInHideMode(t *testing.T) {
	lobby, server := testLobby(t, 3)
	lobby.party, lobby.individual = true, true
	request := map[string]any{"name": "Room", "nickname": "Host", "maxPlayers": 4, "mode": hideMode, "map": "de_dust2"}
	if code, _ := roomRequest(t, server, "/rooms", "POST", "", request); code != 400 {
		t.Fatal("hide accepted a classic map", code)
	}
	request["mode"], request["map"] = individualMode, "wl_hide_depot"
	if code, _ := roomRequest(t, server, "/rooms", "POST", "", request); code != 400 {
		t.Fatal("personal deathmatch accepted a hide map", code)
	}
	request["mode"] = hideMode
	if code, _ := roomRequest(t, server, "/rooms", "POST", "", request); code != 200 {
		t.Fatal("hide rejected its own map", code)
	}
}

func TestPartyModesNeedNativeSupport(t *testing.T) {
	for _, supported := range []bool{false, true} {
		modes := installedModes(mapCatalog, supported, false)
		if slices.ContainsFunc(modes, func(mode modeOption) bool { return mode.ID == infectionMode }) != supported ||
			slices.ContainsFunc(modes, func(mode modeOption) bool { return mode.ID == hideMode }) != supported {
			t.Fatal(modes, supported)
		}
	}
}
