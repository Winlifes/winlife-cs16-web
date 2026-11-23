package main

import (
	"strconv"
	"strings"
	"time"
)

// Party-mode phases and winners come from the native game DLL.
func (m *matchController) consumePartyEvent(event string, now time.Time) []string {
	if !strings.HasPrefix(event, "WINLIFE_PARTY 1 ") || m.view.Phase == "finished" {
		return nil
	}
	fields := strings.Fields(event)
	if len(fields) != 6 {
		return nil
	}
	round, roundErr := strconv.Atoi(fields[3])
	seconds, secondsErr := strconv.Atoi(fields[4])
	winner, winnerErr := strconv.Atoi(fields[5])
	if roundErr != nil || secondsErr != nil || winnerErr != nil || round < 1 || round > m.view.Target || seconds < 0 || seconds > 120 || winner < 0 || winner > 2 {
		return nil
	}
	ends := now.Add(time.Duration(seconds) * time.Second).UnixMilli()
	switch fields[2] {
	case "wait":
		if m.view.Phase != "warmup" {
			m.reset("warmup")
		}
	case "prep":
		if (round == 1 && (m.view.Phase == "warmup" || m.view.Phase == "starting")) || (round == 2 && m.view.Phase == "between") {
			m.view.Phase = "preparing"
			m.view.Round = round
			m.view.Swapped = round == 2
			m.view.EndsAt = ends
		}
	case "live":
		if m.view.Phase == "preparing" && m.view.Round == round {
			m.view.Phase = "live"
			m.view.EndsAt = ends
		}
	case "between", "finish":
		if m.view.Phase != "live" || m.view.Round != round {
			return nil
		}
		if winner != 0 {
			if (winner == 1) != m.view.Swapped {
				m.view.ScoreA++
			} else {
				m.view.ScoreB++
			}
		}
		if fields[2] == "finish" {
			return m.finish()
		}
		m.view.Phase = "between"
		m.view.EndsAt = ends
	}
	return nil
}
