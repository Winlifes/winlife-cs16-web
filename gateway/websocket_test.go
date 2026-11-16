package main

import (
	"bytes"
	"github.com/gorilla/websocket"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebSocketDatagramsReachNativeUDP(t *testing.T) {
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	previous := engineAddress
	engineAddress = udp.LocalAddr().String()
	defer func() { engineAddress = previous }()
	go func() {
		data := make([]byte, 65536)
		n, from, err := udp.ReadFromUDP(data)
		if err == nil {
			udp.WriteToUDP(data[:n], from)
		}
	}()
	server := httptest.NewServer(http.HandlerFunc(datagramHandler))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	ws.WriteJSON([2]any{"winlife:hello", "public-test"})
	packet := []byte{1, 2, 3, 4, 0, 255, 33}
	if err = ws.WriteMessage(websocket.BinaryMessage, packet); err != nil {
		t.Fatal(err)
	}
	kind, response, err := ws.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if kind != websocket.BinaryMessage || !bytes.Equal(packet, response) {
		t.Fatalf("corrupt datagram %v", response)
	}
}

func TestWebSocketRejectsForeignOrigin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(datagramHandler))
	defer server.Close()
	ws, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), http.Header{"Origin": []string{"https://foreign.invalid"}})
	if ws != nil {
		ws.Close()
	}
	if err == nil || response == nil || response.StatusCode != 403 {
		t.Fatal("foreign origin accepted")
	}
}
