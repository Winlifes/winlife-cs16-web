package main

import (
	"sort"
	"time"

	"winlife.local/cs16-gateway/internal/combat"
)

type individualPlayer struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Kills   int    `json:"kills"`
	Deaths  int    `json:"deaths"`
	Playing bool   `json:"playing"`
}

func (m *matchController) resetIndividual(phase string) {
	if phase == "warmup" {
		m.individual = make(map[int]individualPlayer)
		return
	}
	for id, player := range m.individual {
		if !player.Playing {
			delete(m.individual, id)
			continue
		}
		player.Kills, player.Deaths = 0, 0
		m.individual[id] = player
	}
}

func (m *matchController) updateIndividualRoster(event string) {
	player, ok := combat.PlayingTeamChange(event)
	if !ok {
		return
	}
	row, listed := m.individual[player.ID]
	if !listed && (!player.Playing() || m.view.Phase == "finished") {
		return
	}
	row.ID, row.Name, row.Playing = player.ID, player.Name, player.Playing()
	m.individual[player.ID] = row
}

func (m *matchController) playingIndividuals() int {
	count := 0
	for _, player := range m.individual {
		if player.Playing {
			count++
		}
	}
	return count
}

func (m *matchController) rankIndividuals() []individualPlayer {
	if len(m.individual) == 0 {
		return nil
	}
	rows := make([]individualPlayer, 0, len(m.individual))
	for _, row := range m.individual {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Kills != rows[j].Kills {
			return rows[i].Kills > rows[j].Kills
		}
		return rows[i].ID < rows[j].ID
	})
	return rows
}

func (m *matchController) countIndividualKill(event string, now time.Time) []string {
	if now.UnixMilli() >= m.view.EndsAt {
		return m.finish()
	}
	if killer, victim, ok := combat.PlayerKill(event); ok {
		a, v := m.individual[killer.ID], m.individual[victim.ID]
		a.ID, a.Name, a.Playing = killer.ID, killer.Name, true
		v.ID, v.Name, v.Playing = victim.ID, victim.Name, true
		a.Kills++
		v.Deaths++
		m.individual[a.ID], m.individual[v.ID] = a, v
		if a.Kills >= m.view.Target {
			return m.finish()
		}
	} else if player, ok := combat.SuicidePlayer(event); ok {
		row := m.individual[player.ID]
		row.ID, row.Name, row.Playing = player.ID, player.Name, true
		row.Deaths++
		m.individual[row.ID] = row
	}
	return nil
}
