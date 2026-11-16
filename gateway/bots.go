package main

import (
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type botSettings struct {
	Count      int `json:"count"`
	Difficulty int `json:"difficulty"`
}

type botUpdate struct {
	Count      *int `json:"count"`
	Difficulty *int `json:"difficulty"`
}

// One extra native slot lets YaPB admit a human before vacating a bot. The
// lobby still reserves at most MaxPlayers human seats and caps bot quotas to
// the remaining seats, including members whose game is still loading.
func nativeRoomCapacity(maxPlayers int) int { return max(4, maxPlayers+1) }

func (m *roomLobby) trimBotsLocked(room *gameRoom) {
	limit := max(0, room.MaxPlayers-len(room.members))
	if room.Bots.Count > limit {
		room.Bots.Count = limit
		room.botRevision++
		room.botsDirty = true
	}
}

func botConfig(settings botSettings) []byte {
	config := fmt.Sprintf("// Managed by this room's host.\nyb_quota_mode normal\nyb_autovacate 1\nyb_autovacate_keep_slots 1\nyb_kick_after_player_connect 1\nyb_join_after_player 1\nyb_join_delay 0.5\nyb_difficulty_auto 0\nyb_difficulty_min -1\nyb_difficulty_max -1\nyb_difficulty_lock 0\nyb_difficulty %d\nyb_quota %d\n", settings.Difficulty, settings.Count)
	if settings.Count == 0 {
		config += "yb kickall\n"
	}
	return []byte(config)
}

func writeBotConfig(game string, settings botSettings) error {
	path := filepath.Join(game, "cstrike", "winlife_bots.cfg")
	if err := os.WriteFile(path+".next", botConfig(settings), 0600); err != nil {
		return err
	}
	return os.Rename(path+".next", path)
}

// Only a fixed exec command crosses the private worker admin API. Settings
// themselves are validated integers in the room's private, atomic config.
func (m *roomLobby) syncBots(room *gameRoom) error {
	room.botMu.Lock()
	defer room.botMu.Unlock()
	m.mu.Lock()
	if m.rooms[room.ID] != room || room.Phase != "playing" || !room.botsDirty {
		m.mu.Unlock()
		return nil
	}
	settings, revision, port := room.Bots, room.botRevision, room.workerPort+1
	m.mu.Unlock()
	err := writeBotConfig(filepath.Join(m.roomDir(room), "game"), settings)
	if err == nil {
		data := bytes.NewBufferString(`{"command":"exec winlife_bots.cfg"}`)
		req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/console", port), data)
		req.Header.Set("X-CS16-Admin", m.token)
		req.Header.Set("Content-Type", "application/json")
		res, requestErr := m.http.Do(req)
		err = requestErr
		if err == nil {
			res.Body.Close()
			if res.StatusCode != http.StatusOK {
				err = fmt.Errorf("worker returned %d", res.StatusCode)
			}
		}
	}
	m.mu.Lock()
	if room.botRevision == revision {
		room.botsDirty = err != nil
		room.BotsError = ""
		if err != nil {
			room.BotsError = "人机设置已保存，服务端暂未应用，正在自动重试。"
		}
	}
	m.mu.Unlock()
	return err
}

// Called with m.mu held; always releases it before returning.
func (m *roomLobby) botsAPI(w http.ResponseWriter, room *gameRoom, member *roomMember, body botUpdate) {
	if member == nil || member.ID != room.HostID {
		m.mu.Unlock()
		apiError(w, 403, "只有房主可以调整人机")
		return
	}
	if room.Phase == "starting" {
		m.mu.Unlock()
		apiError(w, 409, "正在开局，请进入游戏后再调整人机")
		return
	}
	if body.Count == nil || body.Difficulty == nil || *body.Count < 0 || *body.Count > 15 || *body.Difficulty < 0 || *body.Difficulty > 4 {
		m.mu.Unlock()
		apiError(w, 400, "请选择有效的人机数量和难度")
		return
	}
	limit := room.MaxPlayers - len(room.members)
	if *body.Count > limit {
		m.mu.Unlock()
		apiError(w, 409, fmt.Sprintf("当前最多可添加 %d 个人机，真人和人机共用房间席位", limit))
		return
	}
	room.Bots = botSettings{Count: *body.Count, Difficulty: *body.Difficulty}
	room.botRevision++
	room.botsDirty = true
	room.BotsError = ""
	member.seen = time.Now()
	m.mu.Unlock()
	_ = m.syncBots(room)
	m.mu.Lock()
	v := m.viewLocked(room)
	m.mu.Unlock()
	writeJSON(w, v)
}
