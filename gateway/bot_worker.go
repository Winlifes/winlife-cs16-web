package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type botWorkerUpdate struct {
	Settings botSettings `json:"settings"`
	Revision uint64      `json:"revision"`
}

type botController struct {
	mu      sync.Mutex
	game    string
	command func(string) error
	state   *botWorkerUpdate
}

func newBotController(game string, command func(string) error) *botController {
	return &botController{game: game, command: command}
}

var workerBots = newBotController(env("CS16_GAME_DIR", "./game"), sendConsole)

func (b *botController) snapshot() *botWorkerUpdate {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == nil {
		return nil
	}
	copy := *b.state
	return &copy
}

func (b *botController) apply(update botWorkerUpdate) error {
	if !update.Settings.valid() {
		return fmt.Errorf("invalid bot settings")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	// A lost HTTP reply must not replay a pre-halftime configuration.
	if b.state != nil && update.Revision <= b.state.Revision {
		return nil
	}
	if err := writeBotConfig(b.game, update.Settings); err != nil {
		return err
	}
	if err := b.command("exec winlife_bots.cfg"); err != nil {
		return err
	}
	b.state = &update
	return nil
}

func (b *botController) swapTeams() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == nil || !b.state.Settings.Split {
		return b.command("swapteams 1")
	}
	update := *b.state
	update.Settings.T, update.Settings.CT = update.Settings.CT, update.Settings.T
	if err := writeBotConfig(b.game, update.Settings); err != nil {
		return err
	}
	// One native command buffer applies both quotas and the team swap before
	// YaPB next maintains its quota. Existing bots follow their current squads.
	path := filepath.Join(b.game, "cstrike", "winlife_bot_halftime.cfg")
	if err := os.WriteFile(path, []byte("exec winlife_bots.cfg\nswapteams 1\n"), 0600); err != nil {
		return err
	}
	if err := b.command("exec winlife_bot_halftime.cfg"); err != nil {
		return err
	}
	b.state = &update
	return nil
}
