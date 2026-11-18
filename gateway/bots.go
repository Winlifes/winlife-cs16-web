package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type botSettings struct {
	Count      int  `json:"count"`
	Difficulty int  `json:"difficulty"`
	Split      bool `json:"split"`
	T          int  `json:"t"`
	CT         int  `json:"ct"`
}

type botUpdate struct {
	Count      *int `json:"count"`
	Difficulty *int `json:"difficulty"`
	Split      bool `json:"split"`
	T          *int `json:"t"`
	CT         *int `json:"ct"`
}

func (s botSettings) valid() bool {
	return s.Count >= 0 && s.Count <= 15 && s.Difficulty >= 0 && s.Difficulty <= 4 &&
		(!s.Split || (s.T >= 0 && s.T <= 15 && s.CT >= 0 && s.CT <= 15 && s.Count == s.T+s.CT))
}

func (s *botSettings) trim(limit int) {
	for s.Split && s.T+s.CT > limit {
		if s.T > s.CT {
			s.T--
		} else {
			s.CT--
		}
	}
	if s.Split {
		s.Count = s.T + s.CT
	} else {
		s.Count = min(s.Count, limit)
	}
}

// One extra native slot lets YaPB admit a human before vacating a bot. The
// lobby still reserves at most MaxPlayers human seats and caps bot quotas to
// the remaining seats, including members whose game is still loading.
func nativeRoomCapacity(maxPlayers int) int { return max(4, maxPlayers+1) }

func (m *roomLobby) trimBotsLocked(room *gameRoom) {
	limit := max(0, room.MaxPlayers-len(room.members))
	if room.Bots.Count > limit {
		room.Bots.trim(limit)
		room.botRevision++
		room.botsDirty = true
	}
}

func botConfig(settings botSettings) []byte {
	config := fmt.Sprintf("// Managed by this room's host.\nyb_quota_mode normal\nyb_autovacate 1\nyb_autovacate_keep_slots 1\nyb_kick_after_player_connect 1\nyb_join_after_player 1\nyb_join_delay 0.5\nyb_difficulty_auto 0\nyb_difficulty_min -1\nyb_difficulty_max -1\nyb_difficulty_lock 0\nyb_difficulty %d\nyb_quota %d\n", settings.Difficulty, settings.Count)
	t, ct := -1, -1
	if settings.Split {
		t, ct = settings.T, settings.CT
	}
	config += fmt.Sprintf("yb_winlife_quota_t %d\nyb_winlife_quota_ct %d\n", t, ct)
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

// The worker serializes validated settings with halftime team swaps. It alone
// owns live config writes, so a lobby retry cannot race with the side change.
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
	data, err := json.Marshal(botWorkerUpdate{Settings: settings, Revision: revision})
	if err == nil {
		req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/bots", port), bytes.NewReader(data))
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
	settings := botSettings{Split: body.Split}
	if body.Count != nil {
		settings.Count = *body.Count
	}
	if body.Difficulty != nil {
		settings.Difficulty = *body.Difficulty
	}
	if body.T != nil {
		settings.T = *body.T
	}
	if body.CT != nil {
		settings.CT = *body.CT
	}
	if body.Split {
		settings.Count = settings.T + settings.CT
	}
	if body.Difficulty == nil || (!body.Split && body.Count == nil) || (body.Split && (body.T == nil || body.CT == nil || (body.Count != nil && *body.Count != settings.Count))) || !settings.valid() {
		m.mu.Unlock()
		apiError(w, 400, "请选择有效的人机数量和难度")
		return
	}
	limit := room.MaxPlayers - len(room.members)
	if settings.Count > limit {
		m.mu.Unlock()
		apiError(w, 409, fmt.Sprintf("当前最多可添加 %d 个人机，真人和人机共用房间席位", limit))
		return
	}
	room.Bots = settings
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
