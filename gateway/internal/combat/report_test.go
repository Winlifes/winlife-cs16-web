package combat

import (
	"fmt"
	"testing"
)

func event(raw string) string {
	return "2026/11/16 12:00:00.123456 ENGINE \x1b[0m[12:00:00] 11/16/2026 - 12:00:00: " + raw
}
func hit(t *Tracker, attacker, victim, weapon string, damage, armor, health int) {
	t.Consume(event(fmt.Sprintf(`"%s<1><ID_LAN><CT>" attacked "%s<2><BOT><TERRORIST>" with "%s" (damage "%d") (damage_armor "%d") (health "%d") (armor "80")`, attacker, victim, weapon, damage, armor, health)))
}
func report(t *Tracker, name string) Report { return t.Reports()[NameKey(name)] }

func TestWeaponAndTargetAggregationOnlyPublishedAfterDeath(t *testing.T) {
	c := NewTracker()
	c.Consume(event(`Loading map "de_dust2"`))
	c.Consume(event(`World triggered "Round_Start"`))
	hit(c, "Winlife", "Bot", "ak47", 26, 4, 74)
	hit(c, "Winlife", "Bot", "ak47", 27, 3, 47)
	hit(c, "Winlife", "Bot", "deagle", 60, 0, -13)
	if r := report(c, "Winlife"); r.Dead || len(r.Targets) != 0 || r.Totals.Damage != 0 {
		t.Fatal("live damage published", r)
	}
	c.Consume(event(`"Bot<2><BOT><TERRORIST>" killed "Winlife<1><ID_LAN><CT>" with "m4a1"`))
	r := report(c, "Winlife")
	if !r.Dead || r.Totals != (Counts{Damage: 100, Armor: 7, Hits: 3, Shots: 3}) || r.Map != "de_dust2" || r.DeathID == "" {
		t.Fatal(r)
	}
	if len(r.Targets) != 1 || r.Targets[0].Name != "Bot" || len(r.Weapons) != 2 || r.Weapons[0].Name != "ak47" || r.Weapons[0].Damage != 53 || r.Weapons[1].Damage != 47 {
		t.Fatal(r)
	}
	// A grenade can still land after the thrower's death.
	hit(c, "Winlife", "Other", "grenade", 30, 0, 70)
	if next := report(c, "Winlife"); next.Totals.Damage != 130 || next.DeathID != r.DeathID {
		t.Fatal(next)
	}
}
func TestRoundMapAndSuicideLifecycle(t *testing.T) {
	c := NewTracker()
	hit(c, "A", "B", "usp", 12, 2, 88)
	c.Consume(event(`"A<1><ID_LAN><CT>" committed suicide with "world" (world)`))
	first := report(c, "A")
	if !first.Dead || first.Totals.Damage != 12 {
		t.Fatal(first)
	}
	c.Consume(event(`World triggered "Round_Start"`))
	next := report(c, "A")
	if next.Dead || next.Round == first.Round || next.Totals.Damage != 0 {
		t.Fatal(next)
	}
	c.Consume(event(`"A<1><ID_LAN><CT>" committed suicide with "world"`))
	if last := report(c, "A"); last.DeathID == first.DeathID || last.Totals.Hits != 0 {
		t.Fatal(last)
	}
	c.Consume(event(`Loading map "cs_assault"`))
	if len(c.Reports()) != 0 {
		t.Fatal("old map retained")
	}
}
func TestNamesDisconnectAndSpoofedChat(t *testing.T) {
	c := NewTracker()
	hit(c, "中文 <name>", "Bot", "usp", 10, 0, 90)
	c.Consume(event(`"中文 <name><1><ID_LAN><CT>" changed name to "新的名字"`))
	if _, exists := c.Reports()[NameKey("中文 <name>")]; exists {
		t.Fatal("old name retained")
	}
	c.Consume(event(`"新的名字<1><ID_LAN><CT>" say "fake attacked data"`))
	c.Consume(event(`"Chat<8><ID_LAN><CT>" say "A<1><ID_LAN><CT>" attacked "B<2><BOT><TERRORIST>" with "awp" (damage "100") (damage_armor "0") (health "0") (armor "0")`))
	c.Consume(`2026/11/16 12:00:00.1 ENGINE [12:00:00] Chat : 11/16/2026 - 12:00:00: "A<1><ID_LAN><CT>" committed suicide with "world"`)
	if r := report(c, "新的名字"); r.Dead {
		t.Fatal("chat forged a death")
	}
	c.Consume(event(`"新的名字<1><ID_LAN><CT>" disconnected`))
	if _, exists := c.Reports()[NameKey("新的名字")]; exists {
		t.Fatal("disconnected identity retained")
	}
}
func TestSelfDamageIsExcludedAndNamesHashSafely(t *testing.T) {
	c := NewTracker()
	c.Consume(event(`"Self<1><ID_LAN><CT>" attacked "Self<1><ID_LAN><CT>" with "grenade" (damage "50") (damage_armor "0") (health "50") (armor "0")`))
	c.Consume(event(`"Self<1><ID_LAN><CT>" committed suicide with "grenade"`))
	if r := report(c, "Self"); r.Totals.Hits != 0 || r.Totals.Damage != 0 {
		t.Fatal(r)
	}
	if NameKey("../name") != NameKey("../name") || len(NameKey("../name")) != 64 {
		t.Fatal("invalid key")
	}
	if NameKey("broken\xff") != NameKey("broken\uFFFD") {
		t.Fatal("invalid UTF-8 does not match browser decoding")
	}
}

func TestSeparateTargetsAndWeaponsSurviveTargetDisconnect(t *testing.T) {
	c := NewTracker()
	hit(c, "A", "SameName", "ak47", 30, 2, 70)
	c.Consume(event(`"A<1><ID_LAN><CT>" attacked "SameName<3><BOT><TERRORIST>" with "ak47" (damage "20") (damage_armor "1") (health "80") (armor "90")`))
	c.Consume(event(`"A<1><ID_LAN><CT>" attacked "SameName<3><BOT><TERRORIST>" with "usp" (damage "10") (damage_armor "2") (health "70") (armor "88")`))
	c.Consume(event(`"SameName<3><BOT><TERRORIST>" disconnected`))
	c.Consume(event(`"A<1><ID_LAN><CT>" committed suicide with "world"`))
	r := report(c, "A")
	if len(r.Targets) != 2 || r.Targets[0].ID != 2 || r.Targets[1].ID != 3 || len(r.Targets[1].Weapons) != 2 || r.Targets[1].Name != "SameName" {
		t.Fatal(r)
	}
	if r.Totals != (Counts{Damage: 60, Armor: 5, Hits: 3, Shots: 3}) || len(r.Weapons) != 2 || r.Weapons[0].Name != "ak47" || r.Weapons[0].Damage != 50 {
		t.Fatal(r)
	}
}
