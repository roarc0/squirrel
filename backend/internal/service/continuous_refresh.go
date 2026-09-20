package service

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	portv1 "github.com/roarc0/squirrel/proto/gen/go/v1"
)

const (
	refreshInterval    = 10 * time.Second
	backoffBase        = 30 * time.Second
	backoffMax         = 5 * time.Minute
)

type refreshState struct {
	enabled atomic.Bool
	mu      sync.Mutex
	subs    map[chan *portv1.RefreshTick]struct{}
}

func newRefreshState() *refreshState {
	return &refreshState{
		subs: make(map[chan *portv1.RefreshTick]struct{}),
	}
}

func (rs *refreshState) subscribe() chan *portv1.RefreshTick {
	ch := make(chan *portv1.RefreshTick, 4)
	rs.mu.Lock()
	rs.subs[ch] = struct{}{}
	rs.mu.Unlock()
	return ch
}

func (rs *refreshState) unsubscribe(ch chan *portv1.RefreshTick) {
	rs.mu.Lock()
	delete(rs.subs, ch)
	rs.mu.Unlock()
}

func (rs *refreshState) broadcast(tick *portv1.RefreshTick) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for ch := range rs.subs {
		select {
		case ch <- tick:
		default:
		}
	}
}

// startContinuousRefresh runs the background ETF refresh loop until ctx is cancelled.
func (s *Server) startContinuousRefresh(ctx context.Context) {
	wait := refreshInterval
	timer := time.NewTimer(wait)
	defer timer.Stop()

	var consecutiveErrors int

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if !s.refresh.enabled.Load() {
				timer.Reset(refreshInterval)
				continue
			}

			inst, err := s.store.OldestEnrichedInstrument(ctx)
			if err != nil || inst == nil {
				timer.Reset(refreshInterval)
				continue
			}

			count, _ := s.store.CountRefreshedToday(ctx)
			tick := &portv1.RefreshTick{
				Ticker:         inst.Ticker,
				Isin:           inst.ISIN,
				Enabled:        true,
				Phase:          "refreshing",
				RefreshedToday: count,
			}
			s.refresh.broadcast(tick)

			enrichErr := s.enrichInstrument(ctx, inst.ISIN)
			count, _ = s.store.CountRefreshedToday(ctx)
			tick.RefreshedToday = count

			if enrichErr != nil {
				slog.WarnContext(ctx, "continuous refresh failed", "isin", inst.ISIN, "error", enrichErr)
				consecutiveErrors++
				backoff := backoffBase * time.Duration(consecutiveErrors)
				if backoff > backoffMax {
					backoff = backoffMax
				}
				tick.Phase = "error"
				tick.HasError = true
				s.refresh.broadcast(tick)
				timer.Reset(backoff)
				continue
			}

			consecutiveErrors = 0
			tick.Phase = "waiting"
			s.refresh.broadcast(tick)
			timer.Reset(refreshInterval)
		}
	}
}

func (s *Server) SetContinuousRefresh(_ context.Context, req *connect.Request[portv1.SetContinuousRefreshRequest]) (*connect.Response[portv1.SetContinuousRefreshResponse], error) {
	s.refresh.enabled.Store(req.Msg.Enabled)
	s.refresh.broadcast(&portv1.RefreshTick{
		Enabled: req.Msg.Enabled,
		Phase:   "idle",
	})
	return connect.NewResponse(&portv1.SetContinuousRefreshResponse{}), nil
}

func (s *Server) WatchContinuousRefresh(ctx context.Context, _ *connect.Request[portv1.WatchContinuousRefreshRequest], stream *connect.ServerStream[portv1.RefreshTick]) error {
	ch := s.refresh.subscribe()
	defer s.refresh.unsubscribe(ch)

	count, _ := s.store.CountRefreshedToday(ctx)
	if err := stream.Send(&portv1.RefreshTick{
		Enabled:        s.refresh.enabled.Load(),
		Phase:          "idle",
		RefreshedToday: count,
	}); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case tick, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(tick); err != nil {
				return err
			}
		}
	}
}
