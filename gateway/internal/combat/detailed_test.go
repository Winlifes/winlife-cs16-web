package combat

import (
	"encoding/json"
	"testing"
)

func richHit(c *Tracker, shot string, a, v, damage, armor int, parts [][]float64) {
	e := damageEvent{Version: 2, Shot: shot, Attacker: a, AttackerName: map[int]string{1: "A", 2: "B"}[a], AttackerTeam: a, Victim: v, VictimName: map[int]string{1: "A", 2: "B"}[v], VictimTeam: v, Weapon: "m3", Damage: damage, Armor: armor, Parts: parts}
	raw, _ := json.Marshal(e)
	c.Consume(event("WINLIFE_DAMAGE " + string(raw)))
}
func state(c *Tracker, id, phase string) {
	c.Consume(`2026/11/16 12:00:00.123456 COMBAT_STATE {"id":"` + id + `","phase":"` + phase + `"}`)
}
func TestShotgunPartsBidirectionalAndLivingRoundEnd(t *testing.T) {
	c := NewTracker()
	state(c, "match1", "live")
	c.Consume(event("WINLIFE_COMBAT_READY 2"))
	hit(c, "A", "B", "m3", 50, 10, 50) // legacy duplicate must be ignored
	richHit(c, "10", 1, 2, 50, 10, [][]float64{{1, 1, 20}, {2, 2, 30}})
	richHit(c, "11", 2, 1, 15, 4, [][]float64{{6, 1, 1}})
	if r := report(c, "A"); r.Dead || r.Totals.Damage != 0 {
		t.Fatal("premature round report", r)
	}
	c.Consume(event(`World triggered "Round_End"`))
	a, b := report(c, "A"), report(c, "B")
	if !a.RoundEnded || a.Dead || a.Totals.Damage != 50 || a.Totals.Shots != 1 || a.Totals.Hits != 3 || a.Received.Damage != 15 || len(a.Attackers) != 1 {
		t.Fatal(a)
	}
	p := a.Targets[0].Weapons[0].Parts
	if len(p) != 2 || p[0].Damage != 20 || p[1].Damage != 30 || p[0].Shots != 1 || p[1].Hits != 2 || p[0].Armor+p[1].Armor != 10 {
		t.Fatal(p)
	}
	if b.Received != a.Totals || b.Totals != a.Received {
		t.Fatal("bidirectional totals differ", a, b)
	}
	old := a.Round
	c.Consume(event(`World triggered "Round_Start"`))
	a = report(c, "A")
	if a.RoundEnded || a.Round == old || a.Previous == nil || a.Previous.Round != old || a.Previous.Totals.Damage != 50 {
		t.Fatal(a)
	}
	if b := c.Scoreboard(); b.Players[0].Damage != 50 {
		t.Fatal("round reset erased match totals", b)
	}
	state(c, "match2", "starting")
	a = report(c, "A")
	if a.Previous != nil || a.Totals.Damage != 0 || c.Scoreboard().Players[0].Damage != 0 {
		t.Fatal("rematch retained damage", a)
	}
}
func TestFinalShotAfterNativeWinAndHalftimePreserveCumulative(t *testing.T) {
	c := NewTracker()
	state(c, "one", "live")
	richHit(c, "1", 1, 2, 26, 3, [][]float64{{3, 1, 1}})
	c.Consume(event(`"A<1><LAN><TERRORIST>" killed "B<2><BOT><CT>" with "m3"`))
	state(c, "one", "halftime")
	c.Consume(event(`World triggered "Restart_Round_(1_second)"`))
	state(c, "one", "live")
	richHit(c, "2", 2, 1, 10, 0, [][]float64{{0, 1, 1}})
	state(c, "one", "finished")
	richHit(c, "3", 1, 2, 74, 0, [][]float64{{1, 1, 1}}) // death callback logs winner before TakeDamage returns
	b := c.Scoreboard()
	if b.Players[0].Damage != 100 || b.Players[0].Kills != 1 || b.Players[1].Deaths != 1 {
		t.Fatal(b)
	}
	c.Consume(event(`"A<1><LAN><TERRORIST>" disconnected`))
	if _, ok := c.Reports()[NameKey("A")]; ok {
		t.Fatal("disconnected report exposed")
	}
	if len(c.Scoreboard().Players) != 2 || c.Scoreboard().Players[0].Connected {
		t.Fatal("final participant lost")
	}
}

func TestEmptyTeamStatsLineCannotMovePlayerToSpectators(t *testing.T) {
	c := NewTracker()
	richHit(c, "1", 1, 2, 10, 0, [][]float64{{2, 1, 1}})
	c.Consume(event(`"A<1><LAN><>" triggered "weaponstats"`))
	if c.Scoreboard().Players[0].Team != 1 {
		t.Fatal(c.Scoreboard())
	}
}

func TestHalftimeAutoTeamLogUsesNewTeam(t *testing.T) {
	c := NewTracker()
	richHit(c, "1", 1, 2, 10, 0, [][]float64{{2, 1, 1}})
	c.Consume(event(`"A<1><LAN><TERRORIST>" joined team "CT" (auto)`))
	c.Consume(event(`"B<2><BOT><CT>" joined team "TERRORIST" (auto)`))
	b := c.Scoreboard()
	if b.Players[0].Team != 2 || b.Players[1].Team != 1 || b.Players[0].Damage != 10 {
		t.Fatal(b)
	}
}

func TestSettlementReconnectPreservesFinalSquadAndRematchDropsDepartedPlayers(t *testing.T) {
	c := NewTracker()
	state(c, "m1", "live")
	richHit(c, "1", 1, 2, 10, 0, [][]float64{{2, 1, 1}})
	state(c, "m1", "finished")
	c.Consume(event(`"A<1><LAN><TERRORIST>" disconnected`))
	c.Consume(event(`"A<3><LAN><>" entered the game`))
	b := c.Scoreboard()
	if b.Players[0].Name != "A" || b.Players[0].ID != 3 || b.Players[0].Team != 1 || b.Players[0].Damage != 10 || !b.Players[0].Connected {
		t.Fatal(b)
	}
	c.Consume(event(`"B<2><BOT><CT>" disconnected`))
	state(c, "m2", "starting")
	b = c.Scoreboard()
	if len(b.Players) != 1 || b.Players[0].Name != "A" || b.Players[0].Damage != 0 {
		t.Fatal(b)
	}
}
