// Native WebRTC-to-UDP gateway. The ARM game engine remains the sole game authority.
package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

type peer struct {
	ID                                  string    `json:"id"`
	Nickname                            string    `json:"nickname"`
	State                               string    `json:"state"`
	Protocol                            string    `json:"protocol"`
	ConnectedAt                         time.Time `json:"connectedAt"`
	pc                                  *webrtc.PeerConnection
	udp                                 *net.UDPConn
	ws                                  *websocket.Conn
	send                                *webrtc.DataChannel
	mu                                  sync.Mutex
	once                                sync.Once
	up, down, upBytes, downBytes, drops atomic.Uint64
}

const gatewayVersion = "0.1.10"

var (
	api           *webrtc.API
	peers         = map[string]*peer{}
	peersMu       sync.RWMutex
	console       io.WriteCloser
	consoleMu     sync.Mutex
	linesMu       sync.Mutex
	lines         []string
	started       = time.Now()
	adminToken    string
	engine        *exec.Cmd
	engineAddress = env("CS16_ENGINE_ADDRESS", "127.0.0.1:27015")
	workerMaps    []mapOption
	votes         = map[string]string{}
	lastMapChange time.Time
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(value)
}
func sendConsole(command string) error {
	consoleMu.Lock()
	defer consoleMu.Unlock()
	if console == nil {
		return fmt.Errorf("engine console unavailable")
	}
	_, err := io.WriteString(console, command+"\n")
	return err
}
func capture(r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 8192), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		log.Print("ENGINE ", line)
		linesMu.Lock()
		lines = append(lines, line)
		if len(lines) > 250 {
			lines = lines[len(lines)-250:]
		}
		linesMu.Unlock()
		matchCommands(matches.consume(line, time.Now()))
	}
}
func startEngine() error {
	engine = exec.Command(env("CS16_ENGINE", "./engine/xash"), "-game", "cstrike", "-dll", "@yapb", "-port", env("CS16_ENGINE_PORT", "27015"), "+ip", "127.0.0.1", "+maxplayers", env("CS16_MAX_PLAYERS", "16"), "+map", env("CS16_MAP", "de_dust2"), "+exec", "server.cfg", "-console", "-nowcon", "-noipx")
	engine.Dir = env("CS16_GAME_DIR", "./game")
	var err error
	console, err = engine.StdinPipe()
	if err != nil {
		return err
	}
	out, err := engine.StdoutPipe()
	if err != nil {
		return err
	}
	errout, err := engine.StderrPipe()
	if err != nil {
		return err
	}
	if err = engine.Start(); err != nil {
		return err
	}
	go capture(out)
	go capture(errout)
	go func() { err := engine.Wait(); log.Printf("engine exited: %v", err); os.Exit(1) }()
	return nil
}
func (p *peer) write(event string, data any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return p.ws.WriteJSON([2]any{event, data})
}
func (p *peer) close() {
	p.once.Do(func() {
		peersMu.Lock()
		delete(peers, p.ID)
		delete(votes, p.ID)
		empty := len(peers) == 0
		peersMu.Unlock()
		p.udp.Close()
		sendConsole("kickendpoint " + p.udp.LocalAddr().String())
		if empty {
			matchCommands(matches.empty())
		}
		if p.pc != nil {
			p.pc.Close()
		}
		p.ws.Close()
		log.Printf("peer closed id=%s up=%d down=%d", p.ID, p.up.Load(), p.down.Load())
	})
}
func websocketHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		return err == nil && u.Host == r.Host
	}, HandshakeTimeout: 10 * time.Second}
	peersMu.Lock()
	if len(peers) >= 24 {
		peersMu.Unlock()
		http.Error(w, "Server full", 503)
		return
	}
	peersMu.Unlock()
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	pc, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		ws.Close()
		return
	}
	addr, err := net.ResolveUDPAddr("udp4", engineAddress)
	if err != nil {
		pc.Close()
		ws.Close()
		return
	}
	udp, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		pc.Close()
		ws.Close()
		return
	}
	udp.SetReadBuffer(1024 * 1024)
	id := make([]byte, 8)
	rand.Read(id)
	p := &peer{ID: hex.EncodeToString(id), Nickname: "玩家", State: "new", Protocol: "webrtc", ConnectedAt: time.Now(), pc: pc, ws: ws, udp: udp}
	peersMu.Lock()
	peers[p.ID] = p
	peersMu.Unlock()
	defer p.close()
	ordered := false
	retries := uint16(0)
	p.send, err = pc.CreateDataChannel("write", &webrtc.DataChannelInit{Ordered: &ordered, MaxRetransmits: &retries})
	if err != nil {
		return
	}
	read, err := pc.CreateDataChannel("read", &webrtc.DataChannelInit{Ordered: &ordered, MaxRetransmits: &retries})
	if err != nil {
		return
	}
	read.OnMessage(func(message webrtc.DataChannelMessage) {
		if len(message.Data) > 65507 {
			return
		}
		// A reserved diagnostic datagram measures transport separately from
		// the engine's intentional per-IP A2S query rate limits.
		if len(message.Data) >= 24 && len(message.Data) <= 1200 && bytes.HasPrefix(message.Data, []byte("WINLIFE-RTC-PROBE")) {
			if p.send.ReadyState() == webrtc.DataChannelStateOpen {
				p.send.Send(message.Data)
			}
			return
		}
		n, err := udp.Write(message.Data)
		if err == nil {
			p.up.Add(1)
			p.upBytes.Add(uint64(n))
		}
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		peersMu.Lock()
		p.State = state.String()
		peersMu.Unlock()
		if state == webrtc.PeerConnectionStateFailed {
			go p.close()
		}
	})
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			p.write("v1:candidate", c.ToJSON())
		}
	})
	go func() {
		relayUDP(udp, func(buf []byte) {
			if p.send.ReadyState() != webrtc.DataChannelStateOpen || p.send.BufferedAmount() > 256*1024 {
				p.drops.Add(1)
				return
			}
			if err := p.send.Send(buf); err == nil {
				p.down.Add(1)
				p.downBytes.Add(uint64(len(buf)))
			}
		})
	}()
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return
	}
	if err = pc.SetLocalDescription(offer); err != nil {
		return
	}
	if err = p.write("v1:offer", offer); err != nil {
		return
	}
	ws.SetReadLimit(64 * 1024)
	ws.SetReadDeadline(time.Now().Add(90 * time.Second))
	ws.SetPongHandler(func(string) error { ws.SetReadDeadline(time.Now().Add(90 * time.Second)); return nil })
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.mu.Lock()
				err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
				p.mu.Unlock()
				if err != nil {
					p.close()
					return
				}
			case <-done:
				return
			}
		}
	}()
	var pendingCandidates []webrtc.ICECandidateInit
	for {
		var raw []json.RawMessage
		if err = ws.ReadJSON(&raw); err != nil {
			return
		}
		if len(raw) != 2 {
			return
		}
		ws.SetReadDeadline(time.Now().Add(90 * time.Second))
		var event string
		if json.Unmarshal(raw[0], &event) != nil {
			return
		}
		switch event {
		case "v1:answer":
			var answer webrtc.SessionDescription
			if json.Unmarshal(raw[1], &answer) != nil || pc.SetRemoteDescription(answer) != nil {
				return
			}
			for _, candidate := range pendingCandidates {
				pc.AddICECandidate(candidate)
			}
			pendingCandidates = nil
		case "v1:candidate":
			var candidate webrtc.ICECandidateInit
			if json.Unmarshal(raw[1], &candidate) == nil {
				if pc.RemoteDescription() == nil {
					if len(pendingCandidates) < 32 {
						pendingCandidates = append(pendingCandidates, candidate)
					}
				} else {
					pc.AddICECandidate(candidate)
				}
			}
		case "winlife:hello":
			var nickname string
			if json.Unmarshal(raw[1], &nickname) == nil && len(nickname) <= 96 {
				peersMu.Lock()
				p.Nickname = nickname
				peersMu.Unlock()
			}
		case "winlife:vote":
			var name string
			if json.Unmarshal(raw[1], &name) == nil {
				vote(p, name)
			}
		}
	}
}

func relayUDP(conn *net.UDPConn, accept func([]byte)) {
	buf := make([]byte, 65536)
	for {
		n, err := conn.Read(buf)
		if errors.Is(err, net.ErrClosed) {
			return
		}
		if err != nil {
			// A connected UDP socket can report ICMP ECONNREFUSED while the
			// native engine starts/rebinds. It must remain usable afterwards.
			time.Sleep(25 * time.Millisecond)
			continue
		}
		accept(buf[:n])
	}
}

// HTTPS datagrams use the existing TLS port on networks that block UDP.
// Each browser still has its own UDP connection to the authoritative engine.
func datagramHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		return err == nil && u.Host == r.Host
	}, HandshakeTimeout: 10 * time.Second}
	peersMu.Lock()
	if len(peers) >= 24 {
		peersMu.Unlock()
		http.Error(w, "Server full", 503)
		return
	}
	peersMu.Unlock()
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	addr, err := net.ResolveUDPAddr("udp4", engineAddress)
	if err != nil {
		ws.Close()
		return
	}
	udp, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		ws.Close()
		return
	}
	udp.SetReadBuffer(1024 * 1024)
	id := make([]byte, 8)
	rand.Read(id)
	p := &peer{ID: hex.EncodeToString(id), Nickname: "玩家", State: "connected", Protocol: "websocket", ConnectedAt: time.Now(), ws: ws, udp: udp}
	peersMu.Lock()
	peers[p.ID] = p
	peersMu.Unlock()
	defer p.close()
	go relayUDP(udp, func(data []byte) {
		p.mu.Lock()
		ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		err := ws.WriteMessage(websocket.BinaryMessage, data)
		p.mu.Unlock()
		if err != nil {
			go p.close()
			return
		}
		p.down.Add(1)
		p.downBytes.Add(uint64(len(data)))
	})
	ws.SetReadLimit(65536)
	ws.SetReadDeadline(time.Now().Add(90 * time.Second))
	ws.SetPongHandler(func(string) error { ws.SetReadDeadline(time.Now().Add(90 * time.Second)); return nil })
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.mu.Lock()
				err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
				p.mu.Unlock()
				if err != nil {
					p.close()
					return
				}
			case <-done:
				return
			}
		}
	}()
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		ws.SetReadDeadline(time.Now().Add(90 * time.Second))
		if kind == websocket.BinaryMessage {
			if len(data) > 65507 {
				return
			}
			if len(data) >= 24 && len(data) <= 1200 && bytes.HasPrefix(data, []byte("WINLIFE-RTC-PROBE")) {
				p.mu.Lock()
				ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
				err := ws.WriteMessage(websocket.BinaryMessage, data)
				p.mu.Unlock()
				if err != nil {
					return
				}
				continue
			}
			n, err := udp.Write(data)
			if err == nil {
				p.up.Add(1)
				p.upBytes.Add(uint64(n))
			}
			continue
		}
		var raw []json.RawMessage
		if json.Unmarshal(data, &raw) != nil || len(raw) != 2 {
			continue
		}
		var event string
		json.Unmarshal(raw[0], &event)
		switch event {
		case "winlife:hello":
			var name string
			if json.Unmarshal(raw[1], &name) == nil && len(name) <= 96 {
				peersMu.Lock()
				p.Nickname = name
				peersMu.Unlock()
			}
		case "winlife:vote":
			var name string
			if json.Unmarshal(raw[1], &name) == nil {
				vote(p, name)
			}
		}
	}
}
func vote(p *peer, name string) {
	if !hasMap(workerMaps, name) {
		return
	}
	peersMu.Lock()
	defer peersMu.Unlock()
	if p.State != "connected" {
		return
	}
	votes[p.ID] = name
	count, total := 0, 0
	for id, peer := range peers {
		if peer.State == "connected" {
			total++
			if votes[id] == name {
				count++
			}
		}
	}
	if count >= total/2+1 && time.Since(lastMapChange) > 45*time.Second {
		matches.mapChanged()
		sendConsole("changelevel " + name)
		votes = map[string]string{}
		lastMapChange = time.Now()
		log.Printf("map vote passed map=%s votes=%d/%d", name, count, total)
	}
}

var infoCache struct {
	sync.Mutex
	at    time.Time
	value map[string]any
}

func queryInfo() map[string]any {
	infoCache.Lock()
	defer infoCache.Unlock()
	if time.Since(infoCache.at) < 3*time.Second && infoCache.value != nil {
		return infoCache.value
	}
	infoCache.value = queryNativeInfo()
	infoCache.at = time.Now()
	return infoCache.value
}
func queryNativeInfo() map[string]any {
	c, err := net.DialTimeout("udp4", engineAddress, 300*time.Millisecond)
	if err != nil {
		return map[string]any{"ready": false, "error": err.Error()}
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(500 * time.Millisecond))
	packet := append([]byte{255, 255, 255, 255, 'T'}, []byte("Source Engine Query\x00")...)
	buf := make([]byte, 65536)
	c.Write(packet)
	n, err := c.Read(buf)
	if err != nil {
		return map[string]any{"ready": false, "error": err.Error()}
	}
	if n >= 9 && buf[4] == 'A' {
		packet = append(packet, buf[5:9]...)
		c.Write(packet)
		n, err = c.Read(buf)
		if err != nil {
			return map[string]any{"ready": false, "error": err.Error()}
		}
	}
	return parseInfo(buf[:n])
}
func parseInfo(data []byte) map[string]any {
	n := len(data)
	if n < 6 {
		return map[string]any{"ready": false, "error": "short A2S response"}
	}
	result := map[string]any{"ready": true, "responseType": int(data[4]), "responseBytes": n}
	offset := 6
	str := func() string {
		if offset >= len(data) {
			return ""
		}
		start := offset
		for offset < len(data) && data[offset] != 0 {
			offset++
		}
		s := string(data[start:offset])
		if offset < len(data) {
			offset++
		}
		return s
	}
	if n > 6 && data[4] == 'I' {
		result["protocol"] = int(data[5])
		result["name"] = str()
		result["map"] = str()
		str()
		str()
		offset += 2
		if offset+3 <= len(data) {
			result["players"] = int(data[offset])
			result["maxPlayers"] = int(data[offset+1])
			result["bots"] = int(data[offset+2])
		}
	}
	if data[4] == 'm' {
		offset = 5
		str()
		result["name"] = str()
		result["map"] = str()
		str()
		str()
		if offset+3 <= len(data) {
			result["players"] = int(data[offset])
			result["maxPlayers"] = int(data[offset+1])
			result["protocol"] = int(data[offset+2])
		}
	}
	return result
}
func health(w http.ResponseWriter, r *http.Request) {
	peersMu.RLock()
	list := make([]map[string]any, 0, len(peers))
	for _, p := range peers {
		list = append(list, map[string]any{"id": p.ID, "nickname": p.Nickname, "state": p.State, "protocol": p.Protocol, "connectedAt": p.ConnectedAt, "packetsUp": p.up.Load(), "packetsDown": p.down.Load(), "bytesUp": p.upBytes.Load(), "bytesDown": p.downBytes.Load(), "droppedDown": p.drops.Load()})
	}
	peersMu.RUnlock()
	writeJSON(w, map[string]any{"ok": true, "serverVersion": gatewayVersion + "-" + runtime.GOOS + "-" + runtime.GOARCH, "uptimeSeconds": int(time.Since(started).Seconds()), "engine": queryInfo(), "peers": list, "botSettings": workerBots.snapshot(), "defaultMaxPlayers": 16, "transport": "WebRTC / WebSocket -> native UDP"})
}
func admin(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CS16-Admin")), []byte(adminToken)) != 1 {
		http.Error(w, "Unauthorized", 401)
		return
	}
	if r.URL.Path == "/match/restart" {
		if r.Method != "POST" {
			apiError(w, 405, "POST required")
			return
		}
		commands, ok := matches.restart()
		if !ok {
			apiError(w, 409, "对局尚未结束")
			return
		}
		matchCommands(commands)
		writeJSON(w, matches.snapshot())
		return
	}
	if r.URL.Path == "/bots" {
		if r.Method != "POST" {
			apiError(w, 405, "POST required")
			return
		}
		var update botWorkerUpdate
		if !decodeBody(w, r, &update) {
			return
		}
		if !update.Settings.valid() {
			apiError(w, 400, "invalid bot settings")
			return
		}
		if err := workerBots.apply(update); err != nil {
			apiError(w, 503, err.Error())
			return
		}
		writeJSON(w, workerBots.snapshot())
		return
	}
	if r.URL.Path == "/logs" {
		linesMu.Lock()
		copyLines := append([]string(nil), lines...)
		linesMu.Unlock()
		writeJSON(w, map[string]any{"lines": copyLines})
		return
	}
	if r.Method != "POST" {
		http.Error(w, "POST required", 405)
		return
	}
	var body struct {
		Command string `json:"command"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil || strings.ContainsAny(body.Command, "\n\r;") {
		http.Error(w, "Invalid command", 400)
		return
	}
	if strings.HasPrefix(body.Command, "changelevel ") || strings.HasPrefix(body.Command, "map ") {
		matches.mapChanged()
	}
	if err := sendConsole(body.Command); err != nil {
		http.Error(w, err.Error(), 503)
		return
	}
	writeJSON(w, map[string]any{"accepted": true})
}
func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	if os.Getenv("CS16_ROOM_WORKER") != "1" {
		runLobby()
		return
	}
	token, err := os.ReadFile(env("CS16_ADMIN_TOKEN_FILE", "./admin-token"))
	if err != nil {
		log.Fatal(err)
	}
	adminToken = strings.TrimSpace(string(token))
	if len(adminToken) < 32 {
		log.Fatal("admin token must have at least 32 characters")
	}
	mode := env("CS16_MODE", classicMode)
	workerMaps = modeMaps(installedMaps(env("CS16_GAME_DIR", "./game"), env("CS16_PUBLIC", "./public")), mode)
	matches = newRoomMatch(mode)
	if err = startEngine(); err != nil {
		log.Fatal(err)
	}
	setting := webrtc.SettingEngine{}
	icePort, err := strconv.Atoi(env("CS16_ICE_PORT", "27018"))
	if err != nil {
		log.Fatal(err)
	}
	mux, err := ice.NewMultiUDPMuxFromPort(icePort)
	if err != nil {
		log.Fatal(err)
	}
	defer mux.Close()
	setting.SetICEUDPMux(mux)
	setting.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP4})
	setting.SetIncludeLoopbackCandidate(false)
	if publicIP := os.Getenv("CS16_PUBLIC_IP"); publicIP != "" {
		if ip := net.ParseIP(publicIP); ip == nil || ip.To4() == nil {
			log.Fatal("CS16_PUBLIC_IP must be IPv4")
		}
		setting.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}
	api = webrtc.NewAPI(webrtc.WithSettingEngine(setting))
	muxHTTP := http.NewServeMux()
	muxHTTP.HandleFunc("/websocket", websocketHandler)
	muxHTTP.HandleFunc("/datagram", datagramHandler)
	muxHTTP.HandleFunc("/client-config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"transport": env("CS16_CLIENT_TRANSPORT", "webrtc")})
	})
	muxHTTP.HandleFunc("/healthz", health)
	muxHTTP.HandleFunc("/match", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, matches.snapshot()) })
	files := http.FileServer(http.Dir(env("CS16_PUBLIC", "./public")))
	muxHTTP.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if r.URL.Path == "/game-data-v1.zip" && len(r.URL.Query().Get("sha256")) == 64 {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/", admin)
	go func() { log.Fatal(http.ListenAndServe(env("CS16_ADMIN_LISTEN", "127.0.0.1:27017"), adminMux)) }()
	go func() {
		signals := make(chan os.Signal, 1)
		signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
		<-signals
		sendConsole("quit")
		time.Sleep(time.Second)
		if engine.Process != nil {
			engine.Process.Kill()
		}
		os.Exit(0)
	}()
	log.Printf("native gateway ready public=%s root=%s", env("CS16_LISTEN", "127.0.0.1:27016"), filepath.Clean(env("CS16_PUBLIC", "./public")))
	server := &http.Server{Addr: env("CS16_LISTEN", "127.0.0.1:27016"), Handler: muxHTTP, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		for now := range time.NewTicker(250 * time.Millisecond).C {
			matchCommands(matches.tick(now))
		}
	}()
	log.Fatal(server.ListenAndServe())
}
