-- Throwaway. One ordinary write, for pgbench to repeat while events are being notified.
insert into busy (payload) values (repeat('x', 200));
