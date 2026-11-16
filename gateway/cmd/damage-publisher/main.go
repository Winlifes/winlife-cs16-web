// Publish native death-damage reports without touching running game processes.
package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
	"winlife.local/cs16-gateway/internal/combat"
)

func main() {
	rooms := flag.String("rooms", "./game/.rooms", "Native room state root")
	public := flag.String("public", "./public", "Existing gateway public root")
	once := flag.Bool("once", false, "Scan once and exit")
	flag.Parse()
	publisher, err := combat.NewPublisher(*rooms, *public)
	if err != nil {
		log.Fatal(err)
	}
	if err = publisher.Scan(); err != nil {
		if *once {
			log.Fatal(err)
		}
		log.Print(err)
	}
	if *once {
		return
	}
	log.Print("Native damage publisher ready")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(stop)
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err = publisher.Scan(); err != nil {
				log.Print(err)
			}
		case <-stop:
			return
		}
	}
}
