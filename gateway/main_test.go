package main

import (
	"net"
	"testing"
	"time"
)

func TestUDPRelayRecoversWhenEngineRebinds(t *testing.T) {
	listener, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	address := listener.LocalAddr().(*net.UDPAddr)
	listener.Close()
	conn, err := net.DialUDP("udp4", nil, address)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	got := make(chan string, 1)
	go relayUDP(conn, func(data []byte) { got <- string(data) })
	// Deliberately send to an unbound native-engine port first.
	conn.Write([]byte("early"))
	time.Sleep(80 * time.Millisecond)
	listener, err = net.ListenUDP("udp4", address)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		data := make([]byte, 32)
		_, from, e := listener.ReadFromUDP(data)
		if e == nil {
			listener.WriteToUDP([]byte("recovered"), from)
		}
	}()
	conn.Write([]byte("after-start"))
	select {
	case value := <-got:
		if value != "recovered" {
			t.Fatal(value)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("relay died after transient UDP refusal")
	}
}

func TestInfoMalformed(t *testing.T) {
	for n := 0; n < 80; n++ {
		b := make([]byte, n)
		if n > 4 {
			b[4] = 'I'
		}
		_ = parseInfo(b)
	}
	if parseInfo([]byte{1, 2})["ready"] != false {
		t.Fatal("short responses must not report ready")
	}
}

func TestInfoSource(t *testing.T) {
	b := append([]byte{255, 255, 255, 255, 'I', 48}, []byte("Winlife\x00de_dust2\x00cstrike\x00Counter-Strike\x00")...)
	b = append(b, 10, 0, 2, 16, 0)
	r := parseInfo(b)
	if r["map"] != "de_dust2" || r["players"] != 2 || r["maxPlayers"] != 16 {
		t.Fatalf("%v", r)
	}
}
