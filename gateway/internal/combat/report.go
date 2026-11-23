// Package combat derives combat reports from authoritative server events.
package combat

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const actor = `"([^"\r\n]*)<([0-9]+)><([^<>"]*)><([^<>"]*)>"`

var (
	colors      = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	eventLine   = regexp.MustCompile(`^(?:[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9:.]+ ENGINE )?(?:\[[0-9:]+\] )?(?:L )?[0-9]{2}/[0-9]{2}/[0-9]{4} - [0-9:]+: (.*)$`)
	stateLine   = regexp.MustCompile(`^[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9:.]+ COMBAT_STATE (\{.*\})$`)
	attack      = regexp.MustCompile(`^` + actor + ` attacked ` + actor + ` with "([a-zA-Z0-9_]+)" \(damage "(-?[0-9]+)"\) \(damage_armor "(-?[0-9]+)"\) \(health "(-?[0-9]+)"\) \(armor "(-?[0-9]+)"\)$`)
	killed      = regexp.MustCompile(`^` + actor + ` killed ` + actor + ` with "[^"]+"$`)
	suicide     = regexp.MustCompile(`^` + actor + ` committed suicide with "[^"]+"(?: \(world\))?$`)
	playerEvent = regexp.MustCompile(`^` + actor + ` (.*)$`)
	joinedTeam  = regexp.MustCompile(`^joined team "([^"]+)"(?: \(auto\))?$`)
	loadingMap  = regexp.MustCompile(`^Loading map "([a-zA-Z0-9_]+)"`)
)

// EnemyKillTeam returns the killer's playing team for a native enemy kill.
func EnemyKillTeam(event string) int {
	match := killed.FindStringSubmatch(event)
	if match == nil || match[2] == match[6] {
		return 0
	}
	killer, victim := team(match[4]), team(match[8])
	if (killer == 1 && victim == 2) || (killer == 2 && victim == 1) {
		return killer
	}
	return 0
}

// PlayingTeamChange identifies authoritative assignments and disconnects.
// Team zero removes a player from the playing roster.
func PlayingTeamChange(event string) (string, int, bool) {
	player := playerEvent.FindStringSubmatch(event)
	if player == nil {
		return "", 0, false
	}
	if move := joinedTeam.FindStringSubmatch(player[5]); move != nil {
		return player[2], team(move[1]), true
	}
	if player[5] == "disconnected" {
		return player[2], 0, true
	}
	return "", 0, false
}

type Counts struct {
	Damage int `json:"damage"`
	Armor  int `json:"armor"`
	Hits   int `json:"hits"`
	Shots  int `json:"shots"`
}

func (c *Counts) add(o Counts) {
	c.Damage += o.Damage
	c.Armor += o.Armor
	c.Hits += o.Hits
	c.Shots += o.Shots
}

type Part struct {
	Group int `json:"group"`
	Counts
}
type Weapon struct {
	Name string `json:"name"`
	Counts
	Parts []Part `json:"parts,omitempty"`
}
type Target struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Counts
	Weapons []Weapon `json:"weapons"`
}
type Report struct {
	Version    int      `json:"version"`
	Round      string   `json:"round"`
	Map        string   `json:"map"`
	MatchID    string   `json:"matchId"`
	PlayerID   int      `json:"playerId"`
	PlayerName string   `json:"playerName"`
	Dead       bool     `json:"dead"`
	DeathID    string   `json:"deathId,omitempty"`
	RoundEnded bool     `json:"roundEnded"`
	Totals     Counts   `json:"totals"`
	Weapons    []Weapon `json:"weapons,omitempty"`
	Targets    []Target `json:"targets,omitempty"`
	Received   Counts   `json:"received"`
	Attackers  []Target `json:"attackers,omitempty"`
	Previous   *Report  `json:"previous,omitempty"`
}
type ScorePlayer struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Team      int    `json:"team"`
	Connected bool   `json:"connected"`
	Kills     int    `json:"kills"`
	Deaths    int    `json:"deaths"`
	Damage    int    `json:"damage"`
}
type Board struct {
	Version int           `json:"version"`
	MatchID string        `json:"matchId"`
	Map     string        `json:"map"`
	Phase   string        `json:"phase"`
	Players []ScorePlayer `json:"players"`
}
type aggregate struct {
	Counts
	shots map[string]bool
}

func (a *aggregate) add(c Counts, shot string) {
	a.Damage += c.Damage
	a.Armor += c.Armor
	a.Hits += c.Hits
	if a.shots == nil {
		a.shots = map[string]bool{}
	}
	a.shots[shot] = true
	a.Shots = len(a.shots)
}
func (a *aggregate) merge(b *aggregate) {
	a.Damage += b.Damage
	a.Armor += b.Armor
	a.Hits += b.Hits
	if a.shots == nil {
		a.shots = map[string]bool{}
	}
	for s := range b.shots {
		a.shots[s] = true
	}
	a.Shots = len(a.shots)
}

type weaponState struct {
	aggregate
	parts map[int]*aggregate
}
type targetState struct {
	name    string
	weapons map[string]*weaponState
}
type playerState struct {
	name                  string
	team                  int
	finalTeam             int
	connected             bool
	dead                  bool
	deathID               string
	targets, attackers    map[int]*targetState
	previous              *Report
	kills, deaths, damage int
}
type Tracker struct {
	players                 map[int]*playerState
	epoch                   string
	round, deaths, legacy   uint64
	mapName, matchID, phase string
	ended, rich             bool
}

func NewTracker() *Tracker {
	var id [8]byte
	if _, e := rand.Read(id[:]); e != nil {
		panic(e)
	}
	return &Tracker{players: map[int]*playerState{}, epoch: hex.EncodeToString(id[:])}
}
func normalizeName(n string) string { return strings.ToValidUTF8(n, "\uFFFD") }
func NameKey(name string) string {
	sum := sha256.Sum256([]byte(normalizeName(name)))
	return hex.EncodeToString(sum[:])
}
func number(s string) int { n, _ := strconv.Atoi(s); return n }
func team(s string) int {
	if s == "TERRORIST" {
		return 1
	}
	if s == "CT" {
		return 2
	}
	return 3
}
func (t *Tracker) player(name, raw string) *playerState {
	id := number(raw)
	if id <= 0 {
		return nil
	}
	p := t.players[id]
	if p == nil {
		p = &playerState{targets: map[int]*targetState{}, attackers: map[int]*targetState{}, connected: true}
		t.players[id] = p
	}
	p.name = normalizeName(name)
	return p
}
func (t *Tracker) nextRound() {
	for id, p := range t.players {
		if p.dead || t.ended || len(p.targets) > 0 || len(p.attackers) > 0 {
			r := t.makeReport(id, p, true)
			r.Previous = nil
			p.previous = &r
		}
		p.dead = false
		p.deathID = ""
		p.targets = map[int]*targetState{}
		p.attackers = map[int]*targetState{}
	}
	t.round++
	t.ended = false
}
func (t *Tracker) died(p *playerState, id string) {
	if p == nil || p.dead {
		return
	}
	t.deaths++
	p.dead = true
	p.deathID = t.epoch + ":" + strconv.FormatUint(t.round, 10) + ":" + id + ":" + strconv.FormatUint(t.deaths, 10)
	p.deaths++
}

type damageEvent struct {
	Version      int         `json:"version"`
	Shot         string      `json:"shot"`
	Attacker     int         `json:"attacker"`
	AttackerName string      `json:"attackerName"`
	AttackerTeam int         `json:"attackerTeam"`
	Victim       int         `json:"victim"`
	VictimName   string      `json:"victimName"`
	VictimTeam   int         `json:"victimTeam"`
	Weapon       string      `json:"weapon"`
	Damage       int         `json:"damage"`
	Armor        int         `json:"armor"`
	Parts        [][]float64 `json:"parts"`
}

// Native shotguns apply their batched damage/armour once. Distribute that exact
// result by post-hitgroup trace weight; never change the native damage formula.
func distribute(total int, parts [][]float64) []int {
	r := make([]int, len(parts))
	sum := 0.0
	for _, p := range parts {
		sum += p[2]
	}
	type rem struct {
		i int
		v float64
	}
	left := total
	fractions := []rem{}
	for i, p := range parts {
		exact := float64(total) * p[2] / sum
		r[i] = int(math.Floor(exact))
		left -= r[i]
		fractions = append(fractions, rem{i, exact - float64(r[i])})
	}
	sort.SliceStable(fractions, func(i, j int) bool { return fractions[i].v > fractions[j].v })
	for i := 0; i < left; i++ {
		r[fractions[i%len(fractions)].i]++
	}
	return r
}
func addEvent(values map[int]*targetState, id int, name, weapon, shot string, c Counts, parts []Part) {
	v := values[id]
	if v == nil {
		v = &targetState{name: name, weapons: map[string]*weaponState{}}
		values[id] = v
	}
	v.name = name
	w := v.weapons[weapon]
	if w == nil {
		w = &weaponState{parts: map[int]*aggregate{}}
		v.weapons[weapon] = w
	}
	w.add(c, shot)
	for _, p := range parts {
		a := w.parts[p.Group]
		if a == nil {
			a = &aggregate{}
			w.parts[p.Group] = a
		}
		a.add(p.Counts, shot)
	}
}
func (t *Tracker) damage(e damageEvent) {
	if e.Attacker <= 0 || e.Victim <= 0 || e.Attacker == e.Victim || e.Damage <= 0 || e.Damage > 100000 || e.Armor < 0 || e.Armor > 100000 || len(e.Shot) > 80 || e.Shot == "" || len(e.Parts) == 0 || len(e.Parts) > 8 {
		return
	}
	for _, p := range e.Parts {
		if len(p) != 3 || p[0] < 0 || p[0] > 7 || p[0] != math.Trunc(p[0]) || p[1] < 1 || p[1] > 100 || p[1] != math.Trunc(p[1]) || p[2] <= 0 || math.IsInf(p[2], 0) || math.IsNaN(p[2]) {
			return
		}
	}
	a, v := t.player(e.AttackerName, strconv.Itoa(e.Attacker)), t.player(e.VictimName, strconv.Itoa(e.Victim))
	a.team = e.AttackerTeam
	v.team = e.VictimTeam
	hp, armor := distribute(e.Damage, e.Parts), distribute(e.Armor, e.Parts)
	parts := []Part{}
	count := Counts{Damage: e.Damage, Armor: e.Armor}
	for i, p := range e.Parts {
		count.Hits += int(p[1])
		parts = append(parts, Part{Group: int(p[0]), Counts: Counts{Damage: hp[i], Armor: armor[i], Hits: int(p[1])}})
	}
	weapon := strings.TrimPrefix(strings.ToLower(e.Weapon), "weapon_")
	shot := t.epoch + ":" + e.Shot
	addEvent(a.targets, e.Victim, v.name, weapon, shot, count, parts)
	addEvent(v.attackers, e.Attacker, a.name, weapon, shot, count, parts)
	if a.team != v.team {
		a.damage += e.Damage
	}
}
func (t *Tracker) Consume(line string) {
	line = colors.ReplaceAllString(line, "")
	if m := stateLine.FindStringSubmatch(line); m != nil {
		var s struct {
			ID    string `json:"id"`
			Phase string `json:"phase"`
		}
		if json.Unmarshal([]byte(m[1]), &s) == nil && s.ID != "" {
			if t.matchID != s.ID {
				for id, p := range t.players {
					if !p.connected {
						delete(t.players, id)
						continue
					}
					p.finalTeam = 0
					p.kills = 0
					p.deaths = 0
					p.damage = 0
					p.previous = nil
					p.targets = map[int]*targetState{}
					p.attackers = map[int]*targetState{}
					p.dead = false
					p.deathID = ""
				}
				t.ended = false
				t.nextRound()
				t.matchID = s.ID
			}
			t.phase = s.Phase
			if s.Phase == "finished" {
				t.ended = true
				for _, p := range t.players {
					if p.finalTeam == 0 {
						p.finalTeam = p.team
					}
				}
			}
		}
		return
	}
	parsed := eventLine.FindStringSubmatch(line)
	if len(parsed) != 2 {
		return
	}
	event := parsed[1]
	if event == "WINLIFE_COMBAT_READY 2" {
		t.rich = true
		return
	}
	if strings.HasPrefix(event, "WINLIFE_DAMAGE ") {
		var e damageEvent
		if json.Unmarshal([]byte(strings.TrimPrefix(event, "WINLIFE_DAMAGE ")), &e) == nil && e.Version == 2 {
			t.rich = true
			t.damage(e)
		}
		return
	}
	if m := loadingMap.FindStringSubmatch(event); m != nil {
		t.players = map[int]*playerState{}
		t.mapName = m[1]
		t.nextRound()
		return
	}
	if event == `World triggered "Round_End"` {
		t.ended = true
		return
	}
	if strings.HasPrefix(event, `Team "CT" triggered `) || strings.HasPrefix(event, `Team "TERRORIST" triggered `) {
		t.ended = true
		return
	}
	if event == `World triggered "Round_Start"` || strings.HasPrefix(event, `World triggered "Game_Commencing"`) || strings.HasPrefix(event, `World triggered "Restart_Round_(`) {
		if t.phase != "finished" {
			t.nextRound()
		}
		return
	}
	if m := attack.FindStringSubmatch(event); m != nil {
		if t.rich {
			return
		}
		t.legacy++
		t.damage(damageEvent{Version: 2, Shot: "legacy:" + strconv.FormatUint(t.legacy, 10), Attacker: number(m[2]), AttackerName: m[1], AttackerTeam: team(m[4]), Victim: number(m[6]), VictimName: m[5], VictimTeam: team(m[8]), Weapon: m[9], Damage: max(0, number(m[10])+min(0, number(m[12]))), Armor: max(0, number(m[11])), Parts: [][]float64{{0, 1, 1}}})
		return
	}
	if m := killed.FindStringSubmatch(event); m != nil {
		a, v := t.player(m[1], m[2]), t.player(m[5], m[6])
		if a != nil {
			a.team = team(m[4])
			if m[2] != m[6] && m[4] != m[8] {
				a.kills++
			}
		}
		if v != nil {
			v.team = team(m[8])
		}
		t.died(v, m[6])
		return
	}
	if m := suicide.FindStringSubmatch(event); m != nil {
		t.died(t.player(m[1], m[2]), m[2])
		return
	}
	if m := playerEvent.FindStringSubmatch(event); m != nil {
		if strings.HasPrefix(m[5], "say ") || strings.HasPrefix(m[5], "say_team ") {
			return
		}
		p := t.player(m[1], m[2])
		if p == nil {
			return
		}
		if m[4] != "" {
			p.team = team(m[4])
		}
		if m[5] == "disconnected" {
			p.connected = false
			return
		}
		p.connected = true
		if j := joinedTeam.FindStringSubmatch(m[5]); j != nil {
			p.team = team(j[1])
		}
		if strings.HasPrefix(m[5], `changed name to "`) {
			p.name = normalizeName(strings.TrimSuffix(strings.TrimPrefix(m[5], `changed name to "`), `"`))
		}
	}
}
func sortedWeapons(values map[string]*weaponState) []Weapon {
	out := []Weapon{}
	for name, v := range values {
		w := Weapon{Name: name, Counts: v.Counts}
		for group, a := range v.parts {
			w.Parts = append(w.Parts, Part{Group: group, Counts: a.Counts})
		}
		sort.Slice(w.Parts, func(i, j int) bool { return w.Parts[i].Group < w.Parts[j].Group })
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Damage != out[j].Damage {
			return out[i].Damage > out[j].Damage
		}
		return out[i].Name < out[j].Name
	})
	return out
}
func detail(values map[int]*targetState) (Counts, []Weapon, []Target) {
	global := map[string]*weaponState{}
	targets := []Target{}
	total := &aggregate{}
	for id, v := range values {
		target := Target{ID: id, Name: v.name, Weapons: sortedWeapons(v.weapons)}
		sum := &aggregate{}
		for name, w := range v.weapons {
			sum.merge(&w.aggregate)
			g := global[name]
			if g == nil {
				g = &weaponState{parts: map[int]*aggregate{}}
				global[name] = g
			}
			g.merge(&w.aggregate)
			for group, p := range w.parts {
				a := g.parts[group]
				if a == nil {
					a = &aggregate{}
					g.parts[group] = a
				}
				a.merge(p)
			}
		}
		target.Counts = sum.Counts
		total.merge(sum)
		targets = append(targets, target)
	}
	sort.Slice(targets, func(i, j int) bool {
		if targets[i].Damage != targets[j].Damage {
			return targets[i].Damage > targets[j].Damage
		}
		return targets[i].ID < targets[j].ID
	})
	return total.Counts, sortedWeapons(global), targets
}
func (t *Tracker) makeReport(id int, p *playerState, force bool) Report {
	r := Report{Version: 2, Round: t.epoch + ":" + strconv.FormatUint(t.round, 10), Map: t.mapName, MatchID: t.matchID, PlayerID: id, PlayerName: p.name, Dead: p.dead, DeathID: p.deathID, RoundEnded: t.ended, Previous: p.previous}
	if force || p.dead || t.ended {
		r.Totals, r.Weapons, r.Targets = detail(p.targets)
		r.Received, _, r.Attackers = detail(p.attackers)
	}
	return r
}
func (t *Tracker) Reports() map[string]Report {
	r := map[string]Report{}
	for id, p := range t.players {
		if p.connected {
			r[NameKey(p.name)] = t.makeReport(id, p, false)
		}
	}
	return r
}
func (t *Tracker) Scoreboard() Board {
	b := Board{Version: 2, Map: t.mapName, MatchID: t.matchID, Phase: t.phase, Players: []ScorePlayer{}}
	byName := map[string]int{}
	ids := []int{}
	for id := range t.players {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		p := t.players[id]
		squad := p.team
		if t.phase == "finished" && p.finalTeam > 0 {
			squad = p.finalTeam
		}
		if i, ok := byName[p.name]; ok {
			v := &b.Players[i]
			v.Kills += p.kills
			v.Deaths += p.deaths
			v.Damage += p.damage
			v.ID = id
			v.Connected = p.connected
			if t.phase != "finished" || p.finalTeam > 0 || v.Team == 0 {
				v.Team = squad
			}
			continue
		}
		byName[p.name] = len(b.Players)
		b.Players = append(b.Players, ScorePlayer{ID: id, Name: p.name, Team: squad, Connected: p.connected, Kills: p.kills, Deaths: p.deaths, Damage: p.damage})
	}
	return b
}
