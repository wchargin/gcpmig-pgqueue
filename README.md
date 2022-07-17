# gcpmig-pgqueue

Proof-of-concept autoscaling work queue.

This uses a Postgres database as a work queue and notification service, with jobs processed by one or more stateless job servers.
The servers are autoscaled based on CPU load on GCP VMs via a managed instance group.

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

You can also kill one or more workers while it's executing a job and note that its job is eventually picked up by one of the other workers after it's unlocked due to the client disconnection.

## Run on GCP

First, build the Docker image and push it to a GCP container registry:

```sh
docker build -t gcr.io/my-project/gcpmig-pgqueue .  # note the dot
docker push gcr.io/my-project/gcpmig-pgqueue
```

Then, use the Compute Engine web UI to create an instance template based on this container.
Make sure to set libpq environment variables. The "equivalent command line" output should look something like this:

```sh
gcloud compute instance-templates create-with-container \
  my-instance-template \
  --project=my-project \
  --machine-type=e2-medium \
  --network-interface=network=default,network-tier=PREMIUM \
  --maintenance-policy=MIGRATE \
  --provisioning-model=STANDARD \
  --service-account=651075703403-compute@developer.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/devstorage.read_only,https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write,https://www.googleapis.com/auth/servicecontrol,https://www.googleapis.com/auth/service.management.readonly,https://www.googleapis.com/auth/trace.append \
  --container-image=gcr.io/my-project/gcpmig-pgqueue@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --container-restart-policy=always \
  --container-privileged \
  --container-stdin \
  --container-tty \
  --container-env=PGHOST=xxx,PGDATABASE=scratch,PGUSER=yyy,PGPASSWORD=zzz \
  --create-disk=auto-delete=yes,boot=yes,device-name=worker-template-10,image=projects/cos-cloud/global/images/cos-stable-97-16919-103-10,mode=rw,size=10,type=pd-balanced \
  --no-shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --labels=container-vm=cos-stable-97-16919-103-10 \
  ;
```

...but my `gcloud(1)` doesn't seem to want to process the `boot=yes` flag to the `--create-disk` argument.
Presumably this is a bug in the GCP web UI.
Presumably there's a way around this.

In the above template, I've pinned a hash for the image.
To update, you can fork the template to point to a new hash, then update the autoscaler to point to the new template and restart the VMs (replacing doesn't seem to be necessary).
Alternatively, you can set `gcpmig-pgqueue:latest` in the template, in which case each VM deployment will be independently created at the latest version by the autoscaler.
Be aware of potential skew, but updating is easier.

Then, use the Compute Engine web UI to create a managed instance group based on this template.
All the default settings are fine!
Add and remove instances, min=1 max=10, 60% CPU utilization, 60 second "cool down" (really warm up? confusing name) period.
Should probably add health checks and autohealing, but this is a proof of concept.

After creating the group, wait for it to spin up an instance.
To check on it, you can `gcloud compute ssh` into the VM.
Run `docker ps` and see if there's a container running the `gcr.io/my-project/gcpmig-pgqueue` image.
If there is, grab its ID and run `docker logs CONTAINER_ID` or `docker attach CONTAINER_ID` to see historical or live logs, respectively.
If there's not, the system is probably still booting up and trying to start the job.
(You may see a `konlet` container running.)
You can keep an eye on `docker image ls` and `docker ps`.

Shortcut: `docker logs $(docker ps -qn1)`.
Useful with `gcloud compute ssh --command`.

With the `FROM node:16` image, time-to-container-start seems to be about 9 to 10 seconds when restarting a VM, or about 37 to 38 seconds when creating a VM from scratch (incl. replacing a VM).
When using Alpine instead with `FROM node:16-alpine`, the startup time is about the same, but the compressed image is 39 MB instead of 333 MB.

Eventually, the logs should indicate that the job is listening.
(You could also check `pg_stat_activity`, I suppose.)
At that point (or before or after, really), add a whole bunch of jobs:

```sh
node add.js 3000 128
```

The instance should start doing work, which you can observe via its logs or by dumping the `responses` table.
Then, if all goes well, the autoscaler should see that its CPU is pegged, and should spin up more instances.
Once all the work is done and something like 10 minutes have gone by (the "stabilization period"), the autoscaler should delete most of the instances again.

To update to a new instance template or to pull a new `:latest` version on all the existing instances:

```sh
gcloud beta compute instance-groups managed rolling-action start-update \
  my-instance-group \
  --zone=us-central1-a \
  --version=template=my-instance-template \
  ;
```

## TODOs

  - Health checks.
  - Removing public IPs on nodes, probably?
    Would be nice to be able to access those from inside the cluster but not need to expose each one directly to the internet.
    However, when I naively try to remove the ephemeral external IP from the network interface in the instance template, the created instances seem to misbehave.
    They have `docker` installed, but `docker image ls` and `docker ps` are always empty, and they don't actually start the worker as desired.
    To investigate.
