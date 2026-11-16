package combat

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const ReportDirectory = "combat-reports-v1"

var roomID = regexp.MustCompile(`^[a-f0-9]{16}$`)
var reportFile = regexp.MustCompile(`^[a-f0-9]{64}\.json$`)

type roomTail struct {
	tracker   *Tracker
	offset    int64
	fragment  []byte
	info      os.FileInfo
	published map[string][]byte
}
type Publisher struct {
	rooms, output string
	tails         map[string]*roomTail
	lastStatus    time.Time
}

func NewPublisher(rooms, public string) (*Publisher, error) {
	p := &Publisher{rooms: rooms, output: filepath.Join(public, ReportDirectory), tails: map[string]*roomTail{}}
	if err := os.MkdirAll(p.output, 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(p.output, "index.html"), []byte("<!doctype html><title>Combat reports</title>"), 0644); err != nil {
		return nil, err
	}
	return p, nil
}
func atomicWrite(path string, data []byte) error {
	if err := os.WriteFile(path+".next", data, 0644); err != nil {
		return err
	}
	return os.Rename(path+".next", path)
}
func (p *Publisher) read(id string, tail *roomTail) error {
	f, err := os.Open(filepath.Join(p.rooms, id, "gateway.log"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if tail.info != nil && (!os.SameFile(tail.info, info) || info.Size() < tail.offset) {
		tail.tracker = NewTracker()
		tail.offset = 0
		tail.fragment = nil
	}
	tail.info = info
	if _, err = f.Seek(tail.offset, io.SeekStart); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(f, 1<<20))
	if err != nil {
		return err
	}
	tail.offset += int64(len(data))
	data = append(tail.fragment, data...)
	last := bytes.LastIndexByte(data, '\n')
	if last >= 0 {
		for _, line := range bytes.Split(data[:last], []byte{'\n'}) {
			tail.tracker.Consume(string(line))
		}
		tail.fragment = append([]byte(nil), data[last+1:]...)
	} else {
		tail.fragment = data
	}
	// Discard an oversized non-game line without allowing unbounded memory.
	if len(tail.fragment) > 65536 {
		tail.fragment = nil
	}
	if tail.offset < info.Size() {
		return nil
	} // Catch up before publishing a partial history.
	dir := filepath.Join(p.output, id)
	if err = os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	if _, err = os.Stat(filepath.Join(dir, "index.html")); os.IsNotExist(err) {
		if err = os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>Combat reports</title>"), 0644); err != nil {
			return err
		}
	}
	desired := map[string][]byte{}
	for key, report := range tail.tracker.Reports() {
		data, e := json.Marshal(report)
		if e != nil {
			return e
		}
		name := key + ".json"
		desired[name] = data
		if !bytes.Equal(tail.published[name], data) {
			if e = atomicWrite(filepath.Join(dir, name), data); e != nil {
				return e
			}
		}
	}
	board, e := json.Marshal(tail.tracker.Scoreboard())
	if e != nil {
		return e
	}
	desired["scoreboard.json"] = board
	if !bytes.Equal(tail.published["scoreboard.json"], board) {
		if e = atomicWrite(filepath.Join(dir, "scoreboard.json"), board); e != nil {
			return e
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if reportFile.MatchString(entry.Name()) && desired[entry.Name()] == nil {
			if err = os.Remove(filepath.Join(dir, entry.Name())); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	tail.published = desired
	return nil
}

// Scan writes only derived JSON beneath its own public namespace. Existing
// gateways already serve these files, so no game or proxy restart is needed.
func (p *Publisher) Scan() error {
	entries, err := os.ReadDir(p.rooms)
	if err != nil {
		if os.IsNotExist(err) {
			entries = nil
		} else {
			return err
		}
	}
	active := map[string]bool{}
	for _, entry := range entries {
		id := entry.Name()
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !roomID.MatchString(id) {
			continue
		}
		active[id] = true
		tail := p.tails[id]
		if tail == nil {
			tail = &roomTail{tracker: NewTracker(), published: map[string][]byte{}}
			p.tails[id] = tail
		}
		if err = p.read(id, tail); err != nil {
			return err
		}
	}
	// Also collect stale output after a reporter or game service restart.
	outputs, err := os.ReadDir(p.output)
	if err != nil {
		return err
	}
	for _, entry := range outputs {
		if entry.IsDir() && roomID.MatchString(entry.Name()) && !active[entry.Name()] {
			if err = os.RemoveAll(filepath.Join(p.output, entry.Name())); err != nil {
				return err
			}
		}
	}
	for id := range p.tails {
		if !active[id] {
			delete(p.tails, id)
		}
	}
	if time.Since(p.lastStatus) > 5*time.Second {
		status, _ := json.Marshal(map[string]any{"version": 2, "ok": true, "rooms": len(active), "updatedAt": time.Now().UnixMilli()})
		if err = atomicWrite(filepath.Join(p.output, "status.json"), status); err != nil {
			return err
		}
		p.lastStatus = time.Now()
	}
	return nil
}
