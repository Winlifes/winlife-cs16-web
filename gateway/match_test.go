package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func nativeEvent(event string) string { return "\x1b[0m[12:00:01] 11/15/2026 - 12:00:01: " + event }
func beginMatch(m *matchController, now time.Time) {
	m.consume(nativeEvent(`World triggered "Game_Commencing"`), now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
}
func win(m *matchController, team string, ct, t int, now time.Time) []string {
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	return m.consume(nativeEvent(fmt.Sprintf(`Team "%s" triggered "CTs_Win" (CT "%d") (T "%d")`, team, ct, t)), now)
}
func TestMatchKeepsSquadScoresThroughHalftimeAndRematch(t *testing.T) {
	m := newMatchController(15)
	now := time.Now()
	beginMatch(m, now)
	for i := 1; i <= 14; i++ {
		if len(win(m, "TERRORIST", 0, i, now)) != 0 {
			t.Fatal("early halftime")
		}
	}
	commands := win(m, "TERRORIST", 0, 15, now)
	if strings.Join(commands, ";") != "mp_freezetime 10;swapteams 1" {
		t.Fatal(commands)
	}
	state := m.snapshot()
	if state.Phase != "halftime" || state.ScoreA != 15 || !state.Swapped {
		t.Fatal(state)
	}
	m.consume(nativeEvent(`World triggered "Restart_Round_(1_second)"`), now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	commands = win(m, "CT", 1, 0, now)
	state = m.snapshot()
	if state.Phase != "finished" || state.ScoreA != 16 || state.ScoreB != 0 || state.Winner != "A" {
		t.Fatal(state)
	}
	if !strings.Contains(strings.Join(commands, ";"), "winlife_pause 1") {
		t.Fatal(commands)
	}
	m.consume(nativeEvent(`World triggered "Restart_Round_(1_second)"`), now)
	if m.snapshot().ScoreA != 16 {
		t.Fatal("result erased by native reset")
	}
	if m.tick(now.Add(19*time.Second)) != nil {
		t.Fatal("early rematch")
	}
	if m.tick(now.Add(24*time.Hour)) != nil || m.snapshot().ScoreA != 16 {
		t.Fatal("settlement must persist until explicit host restart", m.snapshot())
	}
	if m.empty() != nil || m.snapshot().Phase != "finished" {
		t.Fatal("disconnect erased settlement")
	}
	oldID := m.snapshot().ID
	if c, ok := m.restart(); !ok || len(c) == 0 || m.snapshot().ScoreA != 0 || m.snapshot().ID == oldID {
		t.Fatal("rematch failed", m.snapshot())
	}
	if _, ok := m.restart(); ok {
		t.Fatal("duplicate restart accepted")
	}

	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	if m.snapshot().Phase != "live" {
		t.Fatal(m.snapshot())
	}
}
func TestMatchDrawAtThirtyRounds(t *testing.T) {
	m := newMatchController(15)
	now := time.Now()
	beginMatch(m, now)
	for i := 1; i <= 15; i++ {
		win(m, "TERRORIST", 0, i, now)
	}
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	for i := 1; i <= 15; i++ {
		win(m, "TERRORIST", 0, i, now)
	}
	s := m.snapshot()
	if s.Phase != "finished" || s.ScoreA != 15 || s.ScoreB != 15 || s.Winner != "draw" {
		t.Fatal(s)
	}
}
func TestMatchRejectsWarmupChatDuplicateAndUnchangedWins(t *testing.T) {
	m := newMatchController(15)
	now := time.Now()
	win(m, "CT", 1, 0, now)
	if m.snapshot().ScoreB != 0 {
		t.Fatal("warmup scored")
	}
	beginMatch(m, now)
	m.consume(nativeEvent(`"Someone<1><id><TERRORIST>" say "Team \"CT\" triggered \"CTs_Win\" (CT \"1\") (T \"0\")"`), now)
	win(m, "CT", 0, 0, now)
	if m.snapshot().ScoreB != 0 {
		t.Fatal("empty timeout scored")
	}
	line := nativeEvent(`Team "CT" triggered "Target_Saved" (CT "1") (T "0")`)
	m.consume(line, now)
	m.consume(line, now)
	m.consume(nativeEvent(`World triggered "Round_End"`), now)
	if m.snapshot().ScoreB != 1 {
		t.Fatal(m.snapshot())
	}
	m.empty()
	win(m, "CT", 2, 0, now)
	if m.snapshot().Phase != "warmup" || m.snapshot().ScoreB != 0 {
		t.Fatal(m.snapshot())
	}
	beginMatch(m, now)
	win(m, "TERRORIST", 0, 1, now)
	m.mapChanged()
	if m.snapshot().ScoreA != 0 {
		t.Fatal(m.snapshot())
	}
}

func TestNativeNewCommenceAfterTeamEmptiesResetsCounters(t *testing.T) {
	m := newMatchController(15)
	now := time.Now()
	beginMatch(m, now)
	win(m, "CT", 1, 0, now)
	m.consume(nativeEvent(`World triggered "Game_Commencing"`), now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	win(m, "TERRORIST", 0, 1, now)
	if s := m.snapshot(); s.ScoreA != 1 || s.ScoreB != 0 || s.Phase != "live" {
		t.Fatal(s)
	}
}

func TestCommenceScoreSuffixAndExplicitRestartOnly(t *testing.T) {
	m := newMatchController(1)
	now := time.Now()
	m.consume(nativeEvent(`World triggered "Game_Commencing" (CT "0") (T "0")`), now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	win(m, "CT", 1, 0, now)
	m.consume(nativeEvent(`World triggered "Round_Start"`), now)
	win(m, "TERRORIST", 0, 1, now)
	if m.snapshot().Phase != "finished" {
		t.Fatal(m.snapshot())
	}
	if m.tick(now.Add(365*24*time.Hour)) != nil {
		t.Fatal("automatic rematch")
	}
}
