package main

import (
	"encoding/json"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Match totals follow the two starting squads through the native side swap.
// The engine alone decides round winners, kills, purchases and player teams.
type matchView struct {
	ID         string `json:"id"`
	Phase      string `json:"phase"`
	Half       int    `json:"half"`
	Round      int    `json:"round"`
	ScoreA     int    `json:"scoreA"`
	ScoreB     int    `json:"scoreB"`
	Swapped    bool   `json:"swapped"`
	HalfRounds int    `json:"halfRounds"`
	Target     int    `json:"target"`
	EndsAt     int64  `json:"endsAt,omitempty"`
	Winner     string `json:"winner,omitempty"`
}

type matchController struct {
	mu    sync.Mutex
	view  matchView
	armed bool
	ct, t int
}

func newMatchController(halfRounds int) *matchController {
	m := &matchController{view: matchView{HalfRounds: halfRounds, Target: halfRounds + 1}}
	m.reset("warmup")
	return m
}

var matches = newMatchController(15)
var nativeLog = regexp.MustCompile(`(?:L )?\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2}: (.*)$`)
var wonRound = regexp.MustCompile(`^Team "(CT|TERRORIST)" triggered "[A-Za-z_]+" \(CT "(\d+)"\) \(T "(\d+)"\)$`)

func (m *matchController) reset(phase string) {
	half, target := m.view.HalfRounds, m.view.Target
	m.view = matchView{ID: randomID(8), Phase: phase, Half: 1, Round: 1, HalfRounds: half, Target: target}
	m.armed = false
	m.ct = 0
	m.t = 0
	m.publish()
}
func (m *matchController) publish() {
	data, _ := json.Marshal(m.view)
	log.Printf("COMBAT_STATE %s", data)
}
func (m *matchController) snapshot() matchView { m.mu.Lock(); defer m.mu.Unlock(); return m.view }

func matchCommands(commands []string) {
	for _, command := range commands {
		if err := sendConsole(command); err != nil {
			log.Printf("match command %s failed: %v", command, err)
		}
	}
}

func (m *matchController) consume(line string, now time.Time) []string {
	parsed := nativeLog.FindStringSubmatch(line)
	if len(parsed) != 2 {
		return nil
	}
	event := parsed[1]
	m.mu.Lock()
	defer m.mu.Unlock()
	before := m.view
	defer func() {
		if before != m.view {
			m.publish()
		}
	}()
	if strings.HasPrefix(event, `World triggered "Game_Commencing"`) {
		if m.view.Phase != "halftime" && m.view.Phase != "finished" && m.view.Phase != "starting" {
			m.reset("starting")
		}
		return nil
	}
	if strings.HasPrefix(event, `World triggered "Restart_Round_(`) {
		// Native halftime and result restarts clear only engine half scores.
		if m.view.Phase == "live" {
			m.reset("starting")
		}
		return nil
	}
	if event == `World triggered "Round_Start"` {
		switch m.view.Phase {
		case "starting":
			m.view.Phase = "live"
			m.ct = 0
			m.t = 0
			m.armed = true
		case "halftime":
			m.view.Phase = "live"
			m.view.Half = 2
			m.view.EndsAt = 0
			m.ct = 0
			m.t = 0
			m.armed = true
			return []string{"mp_freezetime 3"}
		case "live":
			m.armed = true
		}
		return nil
	}
	won := wonRound.FindStringSubmatch(event)
	if len(won) != 4 || m.view.Phase != "live" || !m.armed {
		return nil
	}
	ct, _ := strconv.Atoi(won[2])
	t, _ := strconv.Atoi(won[3])
	// Empty-server timeout messages have unchanged counters and are not wins.
	valid := won[1] == "CT" && ct == m.ct+1 && t == m.t || won[1] == "TERRORIST" && t == m.t+1 && ct == m.ct
	if !valid {
		return nil
	}
	m.armed = false
	m.ct = ct
	m.t = t
	aWon := (won[1] == "TERRORIST") != m.view.Swapped
	if aWon {
		m.view.ScoreA++
	} else {
		m.view.ScoreB++
	}
	played := m.view.ScoreA + m.view.ScoreB
	m.view.Round = played + 1
	if m.view.ScoreA >= m.view.Target || m.view.ScoreB >= m.view.Target || played >= m.view.HalfRounds*2 {
		m.view.Phase = "finished"
		m.view.EndsAt = 0
		m.view.Round = played
		m.view.Winner = "draw"
		if m.view.ScoreA > m.view.ScoreB {
			m.view.Winner = "A"
		} else if m.view.ScoreB > m.view.ScoreA {
			m.view.Winner = "B"
		}
		return []string{"winlife_pause 1"}
	}
	if played == m.view.HalfRounds {
		m.view.Phase = "halftime"
		m.view.Swapped = true
		m.view.EndsAt = now.Add(11 * time.Second).UnixMilli()
		// ReGameDLL swapteams restarts the round and resets money/equipment.
		return []string{"mp_freezetime 10", "swapteams 1"}
	}
	return nil
}

// Settlement has no deadline. Only the authenticated host can request rematch.
func (m *matchController) tick(now time.Time) []string { return nil }
func (m *matchController) restart() ([]string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.view.Phase != "finished" {
		return nil, false
	}
	m.reset("starting")
	return []string{"winlife_pause 0", "mp_round_infinite 0", "mp_freezetime 3", "sv_restart 1"}, true
}

func (m *matchController) empty() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.view.Phase == "warmup" || m.view.Phase == "finished" {
		return nil
	}
	m.reset("warmup")
	return []string{"mp_round_infinite 0", "mp_freezetime 3", "sv_restart 1"}
}

func (m *matchController) mapChanged() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reset("warmup")
}
