# Backup and recovery deployment notes

The Compose frontend sends `/api` requests through its Vite proxy to the
backend, rather than using the browser's localhost. Rebuild and recreate the
containers after changing the Dockerfile or Compose configuration. The backend
image includes PostgreSQL client tools; their major version must be at least as
new as the database server's major version. Backups in the default Compose
configuration are stored in the `backup_data` volume. Existing settings may
point to a different directory; migrate those files and update settings if
needed. A named volume is not an off-site backup: copy and periodically test
backups in a separate secure location.

Set `BACKUP_VALIDATION_DATABASE_URL` to a **separate disposable PostgreSQL
database** before restore validation. Validation cleans and overwrites that
database. The same host, port and database name as production is rejected even
when the login differs, but DNS aliases or proxies can hide identity: operators
must independently verify isolation. The validation role must have the required
permissions. Production restore first makes a safety backup and both validation
and production restores use a single transaction and stop on error. Test the
whole process on non-production infrastructure before relying on it.

Backup and restore requests can run for a long time. Configure reverse proxies,
load balancers and hosting platforms with suitable request timeouts. If the
connection is lost, check job/request status and server logs before retrying;
losing the response does not mean the server stopped. Scheduler and maintenance
locks are currently process-local: use a single backend worker/instance for
backup scheduling and restore, and quiesce other application writers during a
restore. The module is not a replacement for an independently tested disaster
recovery plan.
