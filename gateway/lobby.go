package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const memberTTL = 3 * time.Minute

type roomMember struct {
	ID          string    `json:"id"`
	Nickname    string    `json:"nickname"`
	JoinedAt    time.Time `json:"joinedAt"`
	token       string
	seen        time.Time
	connections int
}
type roomView struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Map        string       `json:"map"`
	Mode       string       `json:"mode"`
	MaxPlayers int          `json:"maxPlayers"`
	Phase      string       `json:"phase"`
	HostID     string       `json:"hostId"`
	CreatedAt  time.Time    `json:"createdAt"`
	Members    []roomMember `json:"members"`
	Error      string       `json:"error,omitempty"`
	Bots       botSettings  `json:"bots"`
	BotCount   int          `json:"botCount"`
	BotsError  string       `json:"botsError,omitempty"`
}
type gameRoom struct {
	roomView
	members      map[string]*roomMember
	slot         int
	workerPort   int
	process      *roomProcess
	launching    chan struct{}
	emptySince   time.Time
	botMu        sync.Mutex
	settlementMu sync.Mutex
	botRevision  uint64
	botsDirty    bool
}
type roomProcess struct {
	cmd  *exec.Cmd
	done chan struct{}
	once sync.Once
}

func (p *roomProcess) stop() {
	if p == nil {
		return
	}
	p.once.Do(func() {
		_ = p.cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-p.done:
		case <-time.After(2500 * time.Millisecond):
			_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
			<-p.done
		}
	})
}

type roomLobby struct {
	mu                               sync.Mutex
	rooms                            map[string]*gameRoom
	maps                             []mapOption
	party                            bool
	slots                            map[int]bool
	maxRooms                         int
	root, gameDir, executable, token string
	http                             *http.Client
	spawn                            func(*gameRoom) (*roomProcess, error)
	closed                           bool
}

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func cleanText(s string, max int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || strings.ContainsRune("\";\\", r) {
			return -1
		}
		return r
	}, s))
	r := []rune(s)
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}
func apiError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(v) != nil {
		apiError(w, 400, "请求格式不正确")
		return false
	}
	return true
}
func (m *roomLobby) viewLocked(room *gameRoom) roomView {
	v := room.roomView
	v.Members = make([]roomMember, 0, len(room.members))
	for _, p := range room.members {
		v.Members = append(v.Members, *p)
	}
	sort.Slice(v.Members, func(i, j int) bool { return v.Members[i].JoinedAt.Before(v.Members[j].JoinedAt) })
	return v
}
func (m *roomLobby) listLocked() []roomView {
	list := make([]roomView, 0, len(m.rooms))
	for _, room := range m.rooms {
		list = append(list, m.viewLocked(room))
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.Before(list[j].CreatedAt) })
	return list
}
func (m *roomLobby) memberLocked(room *gameRoom, r *http.Request) *roomMember {
	token := r.Header.Get("X-CS16-Session")
	if token == "" {
		token = r.URL.Query().Get("session")
	}
	if len(token) != 48 {
		return nil
	}
	for _, p := range room.members {
		if subtle.ConstantTimeCompare([]byte(token), []byte(p.token)) == 1 {
			return p
		}
	}
	return nil
}
func (m *roomLobby) addLocked(room *gameRoom, name string) *roomMember {
	p := &roomMember{ID: randomID(8), Nickname: name, JoinedAt: time.Now(), token: randomID(24), seen: time.Now()}
	room.members[p.ID] = p
	m.trimBotsLocked(room)
	room.emptySince = time.Time{}
	if room.HostID == "" {
		room.HostID = p.ID
	}
	return p
}
func (m *roomLobby) joinedLocked(w http.ResponseWriter, room *gameRoom, p *roomMember) {
	writeJSON(w, map[string]any{"room": m.viewLocked(room), "memberId": p.ID, "token": p.token})
}
func (m *roomLobby) removeLocked(room *gameRoom, p *roomMember) {
	delete(room.members, p.ID)
	if room.HostID == p.ID {
		room.HostID = ""
		var first *roomMember
		for _, next := range room.members {
			if first == nil || next.JoinedAt.Before(first.JoinedAt) {
				first = next
			}
		}
		if first != nil {
			room.HostID = first.ID
		}
	}
	if len(room.members) == 0 {
		room.emptySince = time.Now()
	}
}
func (m *roomLobby) roomsAPI(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		apiError(w, 403, "请从本站进入联机大厅")
		return
	}
	if r.Method == "GET" {
		m.mu.Lock()
		defer m.mu.Unlock()
		writeJSON(w, map[string]any{"rooms": m.listLocked(), "maxRooms": m.maxRooms})
		return
	}
	if r.Method != "POST" {
		apiError(w, 405, "不支持此操作")
		return
	}
	var b struct {
		Name       string `json:"name"`
		Nickname   string `json:"nickname"`
		Map        string `json:"map"`
		Mode       string `json:"mode"`
		MaxPlayers int    `json:"maxPlayers"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	b.Name = cleanText(b.Name, 32)
	b.Nickname = cleanText(b.Nickname, 24)
	if b.Mode == "" {
		b.Mode = classicMode
	}
	if b.Mode != classicMode && modeConfig(b.Mode) == "" {
		apiError(w, 400, "请选择可用的游戏模式")
		return
	}
	if isPartyMode(b.Mode) && (!m.party || b.MaxPlayers > partyCapacity) {
		apiError(w, 400, "该模式需要新版游戏服务端，人数上限为 10 人")
		return
	}
	if b.Mode == duelMode {
		b.MaxPlayers = 2
	}
	if b.Nickname == "" || b.Name == "" || !utf8.ValidString(b.Name) || !hasMap(modeMaps(m.maps, b.Mode), b.Map) || b.MaxPlayers < 2 || b.MaxPlayers > 16 {
		apiError(w, 400, "请输入昵称、房间名，并选择有效地图及 2–16 人席位")
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		apiError(w, 503, "服务正在更新，请稍后重试")
		return
	}
	if len(m.rooms) >= m.maxRooms {
		apiError(w, 409, "房间已满，请先加入已有房间")
		return
	}
	slot := 0
	for m.slots[slot] {
		slot++
	}
	if slot >= m.maxRooms {
		apiError(w, 409, "空房正在回收，请稍后重试")
		return
	}
	room := &gameRoom{roomView: roomView{ID: randomID(8), Name: b.Name, Map: b.Map, Mode: b.Mode, MaxPlayers: b.MaxPlayers, Phase: "waiting", CreatedAt: time.Now(), Bots: botSettings{Difficulty: 2}}, members: map[string]*roomMember{}, slot: slot, workerPort: roomHTTPPort(slot)}
	m.rooms[room.ID] = room
	m.slots[slot] = true
	p := m.addLocked(room, b.Nickname)
	m.joinedLocked(w, room, p)
}
func sameOrigin(r *http.Request) bool {
	s := r.Header.Get("Origin")
	if s == "" {
		return true
	}
	u, e := url.Parse(s)
	return e == nil && u.Host == r.Host
}

func (m *roomLobby) matchFinished(ctx context.Context, port int) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d/match", port), nil)
	if err != nil {
		return false, err
	}
	res, err := m.http.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	var state struct {
		Phase string `json:"phase"`
	}
	if res.StatusCode != http.StatusOK {
		return false, fmt.Errorf("match status: %d", res.StatusCode)
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 4096)).Decode(&state); err != nil {
		return false, err
	}
	switch state.Phase {
	case "finished":
		return true, nil
	case "warmup", "starting", "live", "halftime":
		return false, nil
	default:
		return false, fmt.Errorf("invalid match phase: %q", state.Phase)
	}
}

func (m *roomLobby) roomAPI(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		apiError(w, 403, "请从本站进入联机大厅")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/rooms/"), "/")
	if len(parts) > 2 || len(parts[0]) != 16 {
		apiError(w, 404, "房间不存在")
		return
	}
	id := parts[0]
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	var joinName string
	var botChange botUpdate
	if action == "bots" && r.Method == "POST" && !decodeBody(w, r, &botChange) {
		return
	}
	if action == "join" && r.Method == "POST" {
		var b struct {
			Nickname string `json:"nickname"`
		}
		if !decodeBody(w, r, &b) {
			return
		}
		joinName = cleanText(b.Nickname, 24)
	}
	m.mu.Lock()
	room := m.rooms[id]
	if room == nil {
		m.mu.Unlock()
		apiError(w, 404, "房间已关闭，请返回大厅")
		return
	}
	if action == "leave" || action == "rematch" {
		// A host exit and a new-match request must observe one ordered decision.
		// Never hold the lobby lock while waiting on another room action or HTTP.
		m.mu.Unlock()
		room.settlementMu.Lock()
		defer room.settlementMu.Unlock()
		m.mu.Lock()
		if m.rooms[id] != room {
			m.mu.Unlock()
			apiError(w, 404, "房间已关闭，请返回大厅")
			return
		}
	}
	p := m.memberLocked(room, r)
	if action == "bots" && r.Method == "POST" {
		m.botsAPI(w, room, p, botChange)
		return
	}
	if action == "" && r.Method == "GET" {
		if p != nil {
			p.seen = time.Now()
		}
		v := m.viewLocked(room)
		m.mu.Unlock()
		writeJSON(w, v)
		return
	}
	if action == "join" && r.Method == "POST" {
		if p != nil {
			p.seen = time.Now()
			m.joinedLocked(w, room, p)
			m.mu.Unlock()
			return
		}
		if joinName == "" {
			m.mu.Unlock()
			apiError(w, 400, "请先设置昵称")
			return
		}
		if len(room.members) >= room.MaxPlayers {
			m.mu.Unlock()
			apiError(w, 409, "房间人数已满")
			return
		}
		p = m.addLocked(room, joinName)
		m.mu.Unlock()
		_ = m.syncBots(room)
		m.mu.Lock()
		m.joinedLocked(w, room, p)
		m.mu.Unlock()
		return
	}
	if action == "leave" && r.Method == "POST" && p != nil {
		dissolve := false
		if p.ID == room.HostID && room.Phase == "playing" && len(room.members) > 1 {
			p.seen = time.Now()
			port := room.workerPort
			m.mu.Unlock()
			finished, err := m.matchFinished(r.Context(), port)
			m.mu.Lock()
			if m.rooms[id] != room {
				m.mu.Unlock()
				apiError(w, 404, "房间已关闭，请返回大厅")
				return
			}
			if err != nil {
				m.mu.Unlock()
				apiError(w, 503, "暂时无法确认对局状态，请重试退出")
				return
			}
			dissolve = finished
		}
		m.removeLocked(room, p)
		closed := dissolve || len(room.members) == 0
		if closed {
			delete(m.rooms, id)
			room.Phase = "closed"
		}
		m.mu.Unlock()
		if closed {
			m.destroy(room)
		}
		writeJSON(w, map[string]bool{"left": true, "closed": closed})
		return
	}
	if action == "start" && r.Method == "POST" && p != nil {
		if room.HostID != p.ID {
			m.mu.Unlock()
			apiError(w, 403, "只有房主可以开始对局")
			return
		}
		if room.Phase != "waiting" && room.Phase != "failed" {
			v := m.viewLocked(room)
			m.mu.Unlock()
			writeJSON(w, v)
			return
		}
		room.Phase = "starting"
		room.Error = ""
		room.BotCount = 0
		room.launching = make(chan struct{})
		p.seen = time.Now()
		v := m.viewLocked(room)
		m.mu.Unlock()
		go m.startRoom(room)
		writeJSON(w, v)
		return
	}
	if action == "rematch" {
		if r.Method != "POST" {
			m.mu.Unlock()
			apiError(w, 405, "POST required")
			return
		}
		if p == nil || room.HostID != p.ID {
			m.mu.Unlock()
			apiError(w, 403, "只有房主可以继续新的一场")
			return
		}
		if room.Phase != "playing" {
			m.mu.Unlock()
			apiError(w, 409, "房间尚未开局")
			return
		}
		p.seen = time.Now()
		port := room.workerPort + 1
		m.mu.Unlock()
		req, _ := http.NewRequestWithContext(r.Context(), "POST", fmt.Sprintf("http://127.0.0.1:%d/match/restart", port), nil)
		req.Header.Set("X-CS16-Admin", m.token)
		res, err := m.http.Do(req)
		if err != nil {
			apiError(w, 503, "游戏服务暂时不可用，请重试")
			return
		}
		defer res.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(res.StatusCode)
		io.Copy(w, io.LimitReader(res.Body, 4096))
		return
	}
	if action == "websocket" || action == "datagram" || action == "healthz" || action == "match" {
		if room.Phase != "playing" {
			m.mu.Unlock()
			apiError(w, 409, "房间尚未开局")
			return
		}
		channel := action == "websocket" || action == "datagram"
		if channel && (p == nil || p.connections >= 2) {
			m.mu.Unlock()
			apiError(w, 403, "请先加入房间")
			return
		}
		if channel {
			p.connections++
			p.seen = time.Now()
		}
		port := room.workerPort
		m.mu.Unlock()
		if channel {
			defer func() { m.mu.Lock(); p.connections--; p.seen = time.Now(); m.mu.Unlock() }()
		}
		proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)})
		original := proxy.Director
		proxy.Director = func(req *http.Request) {
			original(req)
			req.URL.Path = "/" + action
			req.URL.RawPath = ""
			req.URL.RawQuery = ""
			req.Header.Del("X-CS16-Session")
		}
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			apiError(w, 503, "游戏服务正在恢复，请稍后重试")
		}
		proxy.ServeHTTP(w, r)
		return
	}
	m.mu.Unlock()
	apiError(w, 403, "房间凭据已过期，请重新加入")
}
func roomHTTPPort(slot int) int                    { return 27101 + slot*4 }
func (m *roomLobby) roomDir(room *gameRoom) string { return filepath.Join(m.root, room.ID) }

func cloneRoomGame(source, destination, stateRoot string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			if path == stateRoot || entry.Name() == ".rooms" {
				return filepath.SkipDir
			}
			if err = os.MkdirAll(target, 0700); err != nil {
				return err
			}
			if entry.Name() == "logs" {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		// Engine/plugins require an ordinary game tree. Hard-link only immutable
		// media and native libraries; every config, log and bot cache is private.
		ext := strings.ToLower(filepath.Ext(path))
		immutable := strings.Contains("|.wad|.bsp|.mdl|.wav|.mp3|.ogg|.spr|.tga|.bmp|.png|.jpg|.pk3|.pak|.dylib|.so|.dll|.dem|", "|"+ext+"|") && ext != ""
		if immutable {
			if err = os.Link(path, target); err == nil {
				return nil
			}
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode().Perm())
	})
}

func (m *roomLobby) spawnRoom(room *gameRoom) (*roomProcess, error) {
	root := m.roomDir(room)
	game := filepath.Join(root, "game")
	if err := os.RemoveAll(game); err != nil {
		return nil, err
	}
	if err := cloneRoomGame(m.gameDir, game, m.root); err != nil {
		return nil, err
	}
	m.mu.Lock()
	settings, players := room.Bots, len(room.members)
	m.mu.Unlock()
	mode := modeConfig(room.Mode)
	if isPartyMode(room.Mode) {
		mode += fmt.Sprintf("winlife_party_start_players %d\n", max(2, players))
	}
	if mode != "" {
		if err := os.WriteFile(filepath.Join(game, "cstrike", "winlife_mode.cfg"), []byte(mode), 0600); err != nil {
			return nil, err
		}
	}
	for _, name := range []string{"server.cfg", "winlife_map.cfg"} {
		data, err := os.ReadFile(filepath.Join(m.gameDir, "cstrike", name))
		if err != nil {
			return nil, err
		}
		if name == "server.cfg" {
			// The packaged native scoreboard font only covers Latin text. The
			// browser renders the full Unicode room name; keep this header legible.
			data = append(data, []byte("\nhostname \"Winlife CS 1.6 - "+room.ID[:8]+"\"\n")...)
		}
		// The room-owned bot config must follow the packaged quota reset on
		// both initial load and every map change.
		data = append(data, []byte("\nexec winlife_bots.cfg\n")...)
		if mode != "" {
			data = append(data, []byte("exec winlife_mode.cfg\n")...)
		}
		if err = os.WriteFile(filepath.Join(game, "cstrike", name), data, 0600); err != nil {
			return nil, err
		}
	}
	if err := writeBotConfig(game, settings); err != nil {
		return nil, err
	}
	output, err := os.OpenFile(filepath.Join(root, "gateway.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(m.executable)
	cmd.Env = append(os.Environ(),
		"CS16_ROOM_WORKER=1", "CS16_GAME_DIR="+game, "XASH3D_BASEDIR="+game, "XASH3D_RODIR=",
		"CS16_ENGINE_PORT="+strconv.Itoa(room.workerPort-1), "CS16_ENGINE_ADDRESS=127.0.0.1:"+strconv.Itoa(room.workerPort-1),
		"CS16_LISTEN=127.0.0.1:"+strconv.Itoa(room.workerPort), "CS16_ADMIN_LISTEN=127.0.0.1:"+strconv.Itoa(room.workerPort+1),
		"CS16_ICE_PORT="+strconv.Itoa(room.workerPort+2), "CS16_MAP="+room.Map, "CS16_MODE="+room.Mode, "CS16_MAX_PLAYERS="+strconv.Itoa(nativeRoomCapacity(room.MaxPlayers)))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = output
	cmd.Stderr = output
	if err = cmd.Start(); err != nil {
		output.Close()
		return nil, err
	}
	p := &roomProcess{cmd: cmd, done: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		output.Close()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		close(p.done)
		m.mu.Lock()
		defer m.mu.Unlock()
		if room.Phase != "closed" {
			room.Phase = "failed"
			room.Error = "服务端已停止，房主可以重新开始"
			log.Printf("room %s exited: %v", room.ID, err)
		}
	}()
	return p, nil
}
func (m *roomLobby) startRoom(room *gameRoom) {
	defer close(room.launching)
	p, err := m.spawn(room)
	m.mu.Lock()
	room.process = p
	if room.Phase == "closed" {
		m.mu.Unlock()
		p.stop()
		return
	}
	if err != nil {
		room.Phase = "failed"
		room.Error = "服务端启动失败，请稍后重试"
		m.mu.Unlock()
		log.Printf("room %s start: %v", room.ID, err)
		return
	}
	m.mu.Unlock()
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		res, e := m.http.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", room.workerPort))
		ready := false
		if e == nil {
			var h struct {
				Engine struct {
					Ready bool `json:"ready"`
				} `json:"engine"`
			}
			e = json.NewDecoder(res.Body).Decode(&h)
			res.Body.Close()
			ready = e == nil && h.Engine.Ready
		}
		m.mu.Lock()
		if room.Phase != "starting" {
			m.mu.Unlock()
			return
		}
		if ready {
			room.Phase = "playing"
			room.botsDirty = true
			log.Printf("room %s started map=%s slots=%d", room.ID, room.Map, room.MaxPlayers)
			m.mu.Unlock()
			_ = m.syncBots(room)
			return
		}
		m.mu.Unlock()
		select {
		case <-p.done:
			return
		case <-time.After(300 * time.Millisecond):
		}
	}
	p.stop()
	m.mu.Lock()
	if room.Phase != "closed" {
		room.Phase = "failed"
		room.Error = "服务端准备超时，房主可以重试"
	}
	m.mu.Unlock()
}
func (m *roomLobby) destroy(room *gameRoom) {
	if room.launching != nil {
		<-room.launching
	}
	room.botMu.Lock()
	defer room.botMu.Unlock()
	room.process.stop()
	_ = os.RemoveAll(m.roomDir(room))
	m.mu.Lock()
	delete(m.slots, room.slot)
	m.mu.Unlock()
}
func (m *roomLobby) reap(now time.Time) {
	m.mu.Lock()
	var expired []*gameRoom
	for id, room := range m.rooms {
		for _, p := range room.members {
			if p.connections == 0 && now.Sub(p.seen) > memberTTL {
				m.removeLocked(room, p)
			}
		}
		if len(room.members) == 0 && !room.emptySince.IsZero() && now.Sub(room.emptySince) > 90*time.Second {
			delete(m.rooms, id)
			room.Phase = "closed"
			expired = append(expired, room)
		}
	}
	m.mu.Unlock()
	for _, room := range expired {
		m.destroy(room)
	}
}
func (m *roomLobby) refreshMaps() {
	m.mu.Lock()
	type target struct {
		room *gameRoom
		port int
	}
	var rooms []target
	for _, room := range m.rooms {
		if room.Phase == "playing" {
			rooms = append(rooms, target{room, room.workerPort})
		}
	}
	m.mu.Unlock()
	for _, target := range rooms {
		res, err := m.http.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", target.port))
		if err != nil {
			continue
		}
		var state struct {
			BotSettings *botWorkerUpdate `json:"botSettings"`
			Engine      struct {
				Map   string `json:"map"`
				Bots  int    `json:"bots"`
				Ready bool   `json:"ready"`
			} `json:"engine"`
		}
		err = json.NewDecoder(res.Body).Decode(&state)
		res.Body.Close()
		if err == nil && hasMap(m.maps, state.Engine.Map) {
			m.mu.Lock()
			if m.rooms[target.room.ID] == target.room && target.room.Phase == "playing" {
				target.room.Map = state.Engine.Map
				if state.BotSettings != nil && !target.room.botsDirty && state.BotSettings.Revision == target.room.botRevision && state.BotSettings.Settings.valid() {
					target.room.Bots = state.BotSettings.Settings
				}
				if state.Engine.Ready {
					target.room.BotCount = state.Engine.Bots
				}
			}
			m.mu.Unlock()
		}
		_ = m.syncBots(target.room)
	}
}
func serveGameFiles() http.Handler {
	files := http.FileServer(http.Dir(env("CS16_PUBLIC", "./public")))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasSuffix(r.URL.Path, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		if r.URL.Path == "/game-data-v1.zip" && len(r.URL.Query().Get("sha256")) == 64 {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}
func (m *roomLobby) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/rooms", m.roomsAPI)
	mux.HandleFunc("/rooms/", m.roomAPI)
	mux.HandleFunc("/client-config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"transport": env("CS16_CLIENT_TRANSPORT", "webrtc"), "lobby": true, "maps": m.maps, "modes": installedModes(m.maps, m.party)})
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "serverVersion": gatewayVersion + "-" + runtime.GOOS + "-" + runtime.GOARCH, "lobby": true, "rooms": m.listLocked(), "maxRooms": m.maxRooms, "uptimeSeconds": int(time.Since(started).Seconds())})
	})
	mux.Handle("/", serveGameFiles())
	return mux
}
func (m *roomLobby) adminHandler(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CS16-Admin")), []byte(m.token)) != 1 {
		http.Error(w, "Unauthorized", 401)
		return
	}
	m.mu.Lock()
	room := m.rooms[r.URL.Query().Get("room")]
	if room == nil && len(m.rooms) == 1 {
		for _, candidate := range m.rooms {
			room = candidate
		}
	}
	if room == nil || room.Phase != "playing" {
		m.mu.Unlock()
		apiError(w, 409, "请通过 ?room=<id> 选择已开局的房间")
		return
	}
	port := room.workerPort + 1
	m.mu.Unlock()
	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)})
	proxy.ServeHTTP(w, r)
}
func runLobby() {
	data, err := os.ReadFile(env("CS16_ADMIN_TOKEN_FILE", "./admin-token"))
	if err != nil {
		log.Fatal(err)
	}
	token := strings.TrimSpace(string(data))
	if len(token) < 32 {
		log.Fatal("admin token must have at least 32 characters")
	}
	game, err := filepath.Abs(env("CS16_GAME_DIR", "./game"))
	if err != nil {
		log.Fatal(err)
	}
	root, err := filepath.Abs(env("CS16_ROOMS_DIR", filepath.Join(game, ".rooms")))
	if err != nil {
		log.Fatal(err)
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		log.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	max, err := strconv.Atoi(env("CS16_MAX_ROOMS", "4"))
	if err != nil || max < 1 || max > 8 {
		log.Fatal("CS16_MAX_ROOMS must be 1..8")
	}
	m := &roomLobby{rooms: map[string]*gameRoom{}, slots: map[int]bool{}, maxRooms: max, root: root, gameDir: game, executable: executable, token: token, http: &http.Client{Timeout: time.Second}}
	m.maps = installedMaps(game, env("CS16_PUBLIC", "./public"))
	m.party = supportsPartyModes(game)
	m.spawn = m.spawnRoom
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	server := &http.Server{Addr: env("CS16_LISTEN", "127.0.0.1:27016"), Handler: m.handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	admin := &http.Server{Addr: env("CS16_ADMIN_LISTEN", "127.0.0.1:27017"), Handler: http.HandlerFunc(m.adminHandler), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if e := admin.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			log.Fatal(e)
		}
	}()
	go func() {
		if e := server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			log.Fatal(e)
		}
	}()
	log.Printf("room lobby ready maxRooms=%d", max)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case now := <-ticker.C:
			m.reap(now)
			go m.refreshMaps()
		case <-ctx.Done():
			m.mu.Lock()
			m.closed = true
			rooms := make([]*gameRoom, 0, len(m.rooms))
			for _, room := range m.rooms {
				room.Phase = "closed"
				rooms = append(rooms, room)
			}
			m.rooms = map[string]*gameRoom{}
			m.mu.Unlock()
			var wg sync.WaitGroup
			for _, room := range rooms {
				wg.Add(1)
				go func(room *gameRoom) { defer wg.Done(); m.destroy(room) }(room)
			}
			wg.Wait()
			_ = server.Close()
			_ = admin.Close()
			return
		}
	}
}
