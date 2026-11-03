-- Security advisor 0014 (extension_in_public): pg_net was registered in the
-- public schema. It can't be relocated, so reinstall it in "extensions".
-- Its functions still live in the "net" schema, so private.invoke_divvy_sync()
-- (which calls net.http_post) keeps working.

drop extension if exists pg_net;
create extension pg_net with schema extensions;
