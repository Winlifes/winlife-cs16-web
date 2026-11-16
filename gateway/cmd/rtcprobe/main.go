// Diagnostic peers exercise real WebRTC datagrams, not full game clients.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

type result struct {
	Attempts int `json:"attempts"`
	ID       int       `json:"id"`
	Ready    bool      `json:"connected"`
	Sent     int       `json:"sent"`
	Received int       `json:"received"`
	RTT      []float64 `json:"-"`
	Min      float64   `json:"minMs"`
	Mean     float64   `json:"meanMs"`
	P95      float64   `json:"p95Ms"`
	Max      float64   `json:"maxMs"`
	Error    string    `json:"error,omitempty"`
}

func probe(base string, id int, duration time.Duration, interval time.Duration) (res result) {
	res.ID = id
	u := "ws" + strings.TrimPrefix(base, "http") + "/websocket"
	ws, _, err := websocket.DefaultDialer.Dial(u, http.Header{"Origin": []string{base}})
	if err != nil {
		res.Error = err.Error()
		return
	}
	defer ws.Close()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		res.Error = err.Error()
		return
	}
	defer pc.Close()
	var writeMu, mu sync.Mutex
	write := func(event string, v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return ws.WriteJSON([2]any{event, v})
	}
	write("winlife:hello", fmt.Sprintf("RTC-Probe-%02d", id))
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			write("v1:candidate", c.ToJSON())
		}
	})
	var send *webrtc.DataChannel
	request := make([]byte, 256)
	copy(request, []byte("WINLIFE-RTC-PROBE"))
	pending := map[uint64]time.Time{}
	ready := make(chan struct{})
	var once sync.Once
	pc.OnDataChannel(func(d *webrtc.DataChannel) {
		if d.Label() == "read" {
			send = d
			d.OnOpen(func() { once.Do(func() { close(ready) }) })
		}
		if d.Label() == "write" {
			d.OnMessage(func(m webrtc.DataChannelMessage) {
				mu.Lock()
				defer mu.Unlock()
				if len(m.Data) == 256 && bytes.HasPrefix(m.Data, []byte("WINLIFE-RTC-PROBE")) {
					id := binary.LittleEndian.Uint64(m.Data[24:32])
					if at, ok := pending[id]; ok {
						res.Received++
						res.RTT = append(res.RTT, float64(time.Since(at).Microseconds())/1000)
						delete(pending, id)
					}
				}
			})
		}
	})
	go func() {
		var pending []webrtc.ICECandidateInit
		for {
			var raw []json.RawMessage
			if ws.ReadJSON(&raw) != nil {
				return
			}
			if len(raw) != 2 {
				continue
			}
			var event string
			json.Unmarshal(raw[0], &event)
			switch event {
			case "v1:offer":
				var offer webrtc.SessionDescription
				json.Unmarshal(raw[1], &offer)
				if pc.SetRemoteDescription(offer) != nil {
					return
				}
				answer, e := pc.CreateAnswer(nil)
				if e != nil {
					return
				}
				pc.SetLocalDescription(answer)
				write("v1:answer", answer)
				for _, c := range pending {
					pc.AddICECandidate(c)
				}
				pending = nil
			case "v1:candidate":
				var c webrtc.ICECandidateInit
				json.Unmarshal(raw[1], &c)
				if pc.RemoteDescription() == nil {
					pending = append(pending, c)
				} else {
					pc.AddICECandidate(c)
				}
			}
		}
	}()
	select {
	case <-ready:
		res.Ready = true
	case <-time.After(10 * time.Second):
		res.Error = fmt.Sprintf("RTC handshake timed out (peer=%s ice=%s)",pc.ConnectionState(),pc.ICEConnectionState())
		return
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			mu.Lock()
			res.Sent++
			id := uint64(res.Sent)
			pending[id] = time.Now()
			binary.LittleEndian.PutUint64(request[24:32], id)
			send.Send(request)
			mu.Unlock()
		case <-timer.C:
			// Drain in-flight datagrams before counting missing replies.
			ticker.Stop()
			time.Sleep(500 * time.Millisecond)
			mu.Lock()
			defer mu.Unlock()
			sort.Float64s(res.RTT)
			if len(res.RTT) > 0 {
				res.Min = res.RTT[0]
				res.Max = res.RTT[len(res.RTT)-1]
				res.P95 = res.RTT[(len(res.RTT)-1)*95/100]
				for _, v := range res.RTT {
					res.Mean += v
				}
				res.Mean /= float64(len(res.RTT))
			}
			return
		}
	}
}
func main() {
	base := flag.String("url", "https://localhost:8443", "HTTPS origin")
	n := flag.Int("peers", 8, "diagnostic RTC peers")
	seconds := flag.Int("seconds", 30, "duration")
	ms := flag.Int("interval-ms", 10, "datagram interval")
	flag.Parse()
	if *n < 1 || *n > 20 {
		panic("peers must be 1..20")
	}
	results := make([]result, *n)
	var wg sync.WaitGroup
	begin := time.Now()
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for attempt:=1;attempt<=3;attempt++ {
				results[i] = probe(*base, i, time.Duration(*seconds)*time.Second, time.Duration(*ms)*time.Millisecond)
				results[i].Attempts=attempt
				if results[i].Ready {break}
			}
		}(i)
	}
	wg.Wait()
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(map[string]any{"startedAt": begin.UTC(), "durationSeconds": time.Since(begin).Seconds(), "packetBytes": 256, "intervalMs": *ms, "type": "synthetic WebRTC datagram echo, not game clients", "peers": results})
	for _, r := range results {
		if !r.Ready || r.Received == 0 {
			os.Exit(1)
		}
	}
}
