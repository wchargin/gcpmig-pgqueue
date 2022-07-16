# gcpmig-pgqueue

## Demo locally

Initialize a database:

```sh
createdb scratch
psql scratch -f ./migrations/0001_req_res_queue.sql
```

Configure your environment:

```ini
# .env
PGHOST=/var/run/postgresql  # on Debian, else see "psql -c '\conninfo'"
PGDATABASE=scratch
```

Start some workers:

```sh
node worker.js & node worker.js & node worker.js & :
```

Add some requests:

```sh
node add.js 5000 5
```

...and observe via logs that workers claim and complete requests.

Inspect the results:

```sh
psql scratch -c "TABLE responses"
```

Tear down your workers:

```sh
kill %1 %2 %3
```

You can also kill one or more workers while it's executing a job and
note that its job is eventually picked up by one of the other workers
after it's unlocked due to the client disconnection.
