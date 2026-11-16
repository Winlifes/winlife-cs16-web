package combat

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPublisherTailsCompleteLinesAndRemovesOnlyDerivedFiles(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "rooms")
	public := filepath.Join(root, "public")
	id := "0123456789abcdef"
	dir := filepath.Join(source, id)
	os.MkdirAll(dir, 0700)
	path := filepath.Join(dir, "gateway.log")
	line := event(`"A<1><ID_LAN><CT>" committed suicide with "world"`) + "\n"
	os.WriteFile(path, []byte(line[:len(line)/2]), 0600)
	p, err := NewPublisher(source, public)
	if err != nil {
		t.Fatal(err)
	}
	if err = p.Scan(); err != nil {
		t.Fatal(err)
	}
	reportPath := filepath.Join(public, ReportDirectory, id, NameKey("A")+".json")
	if _, err = os.Stat(reportPath); !os.IsNotExist(err) {
		t.Fatal("partial line parsed")
	}
	f, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString(line[len(line)/2:])
	f.Close()
	if err = p.Scan(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatal(err)
	}
	var r Report
	json.Unmarshal(data, &r)
	if !r.Dead {
		t.Fatal(r)
	}
	f, _ = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString(event(`World triggered "Round_Start"`) + "\n")
	f.Close()
	p.Scan()
	data, _ = os.ReadFile(reportPath)
	json.Unmarshal(data, &r)
	if r.Dead {
		t.Fatal("new round did not clear report")
	}
	// The reporter must not modify the authoritative log.
	original, _ := os.ReadFile(path)
	os.RemoveAll(dir)
	if err = p.Scan(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Dir(reportPath)); !os.IsNotExist(err) {
		t.Fatal("closed-room output retained")
	}
	if len(original) <= len(line) {
		t.Fatal("test log unexpectedly changed")
	}
}
func TestPublisherRecoversFromTruncationAndDoesNotRepeatDamage(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "rooms")
	public := filepath.Join(root, "public")
	id := "0123456789abcdef"
	dir := filepath.Join(source, id)
	os.MkdirAll(dir, 0700)
	log := event(`"A<1><ID_LAN><CT>" attacked "B<2><BOT><TERRORIST>" with "ak47" (damage "30") (damage_armor "0") (health "70") (armor "0")`) + "\n" + event(`"A<1><ID_LAN><CT>" committed suicide with "world"`) + "\n"
	path := filepath.Join(dir, "gateway.log")
	os.WriteFile(path, []byte(log), 0600)
	p, _ := NewPublisher(source, public)
	p.Scan()
	p.Scan()
	reportPath := filepath.Join(public, ReportDirectory, id, NameKey("A")+".json")
	data, _ := os.ReadFile(reportPath)
	var r Report
	json.Unmarshal(data, &r)
	if r.Totals.Damage != 30 || r.Totals.Hits != 1 {
		t.Fatal(r)
	}
	os.WriteFile(path, []byte(event(`"A<1><ID_LAN><CT>" entered the game`)+"\n"), 0600)
	if err := p.Scan(); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(reportPath)
	json.Unmarshal(data, &r)
	if r.Dead || r.Totals.Damage != 0 {
		t.Fatal("old process state retained", r)
	}
}
