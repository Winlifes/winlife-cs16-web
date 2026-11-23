package main

import (
	"encoding/json"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"winlife.local/cs16-gateway/internal/combat"
)

const (
	deathmatchDuration = 8 * time.Minute
	deathmatchTarget   = 30
)

type matchView struct {
	ID         string `json:"id"`
	Mode       string `json:"mode"`
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

type matchSnapshot struct {
	matchView
	Players []individualPlayer `json:"players,omitempty"`
}

type matchController struct {
	mu         sync.Mutex
	view       matchView
	armed      bool
	ct, t      int
	teams      map[int]int
	individual map[int]individualPlayer
}

func newMatchController(halfRounds int) *matchController {
	m := &matchController{view: matchView{Mode: classicMode, HalfRounds: halfRounds, Target: halfRounds + 1}}
	m.reset("warmup")
	return m
}

func newRoomMatch(mode string) *matchController {
	var view matchView
	switch mode {
	case duelMode:
		view = matchView{Mode: duelMode, Target: 7}
	case deathmatchMode, individualMode:
		view = matchView{Mode: mode, Target: deathmatchTarget}
	case infectionMode:
		view = matchView{Mode: infectionMode, Target: 1}
	case hideMode:
		view = matchView{Mode: hideMode, Target: 2}
	default:
		return newMatchController(15)
	}
	m := &matchController{view: view}
	m.reset("warmup")
	return m
}

var matches = newMatchController(15)
var nativeLog = regexp.MustCompile(`(?:L )?\d{2}/\d{2}/\d{4} - \d{2}:\d{2}:\d{2}: (.*)$`)
var wonRound = regexp.MustCompile(`^Team "(CT|TERRORIST)" triggered "[A-Za-z_]+" \(CT "(\d+)"\) \(T "(\d+)"\)$`)

func (m *matchController) reset(phase string) {
	m.view = matchView{ID: randomID(8), Mode: m.view.Mode, Phase: phase, Half: 1, Round: 1, HalfRounds: m.view.HalfRounds, Target: m.view.Target}
	m.armed = false
	m.ct = 0
	m.t = 0
	if phase == "warmup" && m.view.Mode == deathmatchMode {
		m.teams = make(map[int]int)
	}
	if m.view.Mode == individualMode {
		m.resetIndividual(phase)
	}
	m.publish()
}
func (m *matchController) publish() {
	data, _ := json.Marshal(m.view)
	log.Printf("COMBAT_STATE %s", data)
}
func (m *matchController) snapshot() matchSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return matchSnapshot{matchView: m.view, Players: m.rankIndividuals()}
}

func (m *matchController) timedDeathmatch() bool {
	return m.view.Mode == deathmatchMode || m.view.Mode == individualMode
}

func matchCommands(commands []string) {
	for _, command := range commands {
		var err error
		if command == "swapteams 1" {
			err = workerBots.swapTeams()
		} else {
			err = sendConsole(command)
		}
		if err != nil {
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
	if isPartyMode(m.view.Mode) {
		return m.consumePartyEvent(event, now)
	}
	if m.view.Mode == deathmatchMode && m.view.Phase == "warmup" {
		return m.waitForDeathmatchTeams(event)
	}
	if m.view.Mode == individualMode {
		m.updateIndividualRoster(event)
		switch m.view.Phase {
		case "warmup":
			if m.playingIndividuals() >= 2 {
				m.reset("starting")
				return []string{"sv_restart 1"}
			}
			return nil
		case "finished":
			return nil
		}
	}
	if strings.HasPrefix(event, `World triggered "Game_Commencing"`) {
		if m.view.Mode != individualMode && m.view.Phase != "halftime" && m.view.Phase != "finished" && m.view.Phase != "starting" {
			m.reset("starting")
		}
		return nil
	}
	if strings.HasPrefix(event, `World triggered "Restart_Round_(`) {
		// Native halftime and result restarts clear only engine half scores.
		if m.view.Phase == "live" && m.view.Mode != individualMode {
			m.reset("starting")
		}
		return nil
	}
	if event == `World triggered "Round_Start"` {
		switch m.view.Phase {
		case "starting":
			if m.view.Mode == individualMode && m.playingIndividuals() < 2 {
				m.view.Phase = "warmup"
				return nil
			}
			m.view.Phase = "live"
			m.ct = 0
			m.t = 0
			m.armed = true
			if m.timedDeathmatch() {
				m.view.EndsAt = now.Add(deathmatchDuration).UnixMilli()
			}
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
	if m.view.Mode == deathmatchMode {
		return m.countDeathmatchKill(event, now)
	}
	if m.view.Mode == individualMode && m.view.Phase == "live" {
		return m.countIndividualKill(event, now)
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
	if m.view.ScoreA >= m.view.Target || m.view.ScoreB >= m.view.Target || m.view.HalfRounds > 0 && played >= m.view.HalfRounds*2 {
		m.view.Round = played
		return m.finish()
	}
	if m.view.HalfRounds > 0 && played == m.view.HalfRounds {
		m.view.Phase = "halftime"
		m.view.Swapped = true
		m.view.EndsAt = now.Add(11 * time.Second).UnixMilli()
		// ReGameDLL swapteams restarts the round and resets money/equipment.
		return []string{"mp_freezetime 10", "swapteams 1"}
	}
	return nil
}

func (m *matchController) waitForDeathmatchTeams(event string) []string {
	player, ok := combat.PlayingTeamChange(event)
	if !ok {
		return nil
	}
	if player.Playing() {
		m.teams[player.ID] = player.Team
	} else {
		delete(m.teams, player.ID)
	}
	var hasT, hasCT bool
	for _, side := range m.teams {
		hasT = hasT || side == 1
		hasCT = hasCT || side == 2
	}
	if hasT && hasCT {
		m.reset("starting")
		return []string{"sv_restart 1"}
	}
	return nil
}

func (m *matchController) finish() []string {
	m.view.Phase = "finished"
	m.view.EndsAt = 0
	m.view.Winner = "draw"
	if m.view.Mode == individualMode {
		ranking := m.rankIndividuals()
		if len(ranking) > 0 && (len(ranking) == 1 || ranking[0].Kills > ranking[1].Kills) {
			m.view.Winner = "individual"
		}
	} else if m.view.ScoreA > m.view.ScoreB {
		m.view.Winner = "A"
	} else if m.view.ScoreB > m.view.ScoreA {
		m.view.Winner = "B"
	}
	return []string{"winlife_pause 1"}
}

func (m *matchController) countDeathmatchKill(event string, now time.Time) []string {
	if m.view.Phase != "live" {
		return nil
	}
	if now.UnixMilli() >= m.view.EndsAt {
		return m.finish()
	}
	switch combat.EnemyKillTeam(event) {
	case 1:
		m.view.ScoreA++
	case 2:
		m.view.ScoreB++
	}
	if m.view.ScoreA >= m.view.Target || m.view.ScoreB >= m.view.Target {
		return m.finish()
	}
	return nil
}

func (m *matchController) tick(now time.Time) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.timedDeathmatch() && m.view.Phase == "live" && now.UnixMilli() >= m.view.EndsAt {
		commands := m.finish()
		m.publish()
		return commands
	}
	return nil
}

func (m *matchController) resetEngine() []string {
	if isPartyMode(m.view.Mode) {
		return []string{"winlife_party_reset"}
	}
	if m.timedDeathmatch() {
		return []string{"exec winlife_mode.cfg", "sv_restart 1"}
	}
	return []string{"mp_round_infinite 0", "mp_freezetime 3", "sv_restart 1"}
}

func (m *matchController) restart() ([]string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.view.Phase != "finished" {
		return nil, false
	}
	m.reset("starting")
	return append([]string{"winlife_pause 0"}, m.resetEngine()...), true
}

func (m *matchController) empty() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.view.Phase == "warmup" || m.view.Phase == "finished" {
		return nil
	}
	m.reset("warmup")
	return m.resetEngine()
}

func (m *matchController) mapChanged() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reset("warmup")
}
