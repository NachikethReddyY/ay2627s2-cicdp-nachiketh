# Sandbox image

The image behind the learner shell (`/api/sandbox/shell`) and live code runs (`/api/sandbox/run`). Build it with `docker build -t lq-sandbox:dev services/sandbox` and point `SANDBOX_IMAGE` at the tag.

## Network isolation

Code runs (`run.ts`) get `--network none`. Shell containers (`docker.ts`) need the internet for `pip install` and `npm install`, so they join their own bridge network, `SANDBOX_NETWORK` (default `lq-sbx`). The API creates it on first use with inter-container traffic turned off (`enable_icc=false`), so one learner's container cannot reach another's.

Docker cannot stop a container on that network from reaching the host, the cloud metadata service (169.254.169.254), or private addresses (your database, other services in the VPC). **Every host that runs shells must add these rules** to the `DOCKER-USER` chain, which Docker leaves alone:

```sh
NET=lq-sbx   # your SANDBOX_NETWORK
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --driver bridge -o com.docker.network.bridge.enable_icc=false "$NET"
BR="br-$(docker network inspect -f '{{.Id}}' "$NET" | cut -c1-12)"

# Forwarded traffic: no metadata service, link-local, private or CGNAT ranges.
for cidr in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do
  iptables -I DOCKER-USER -i "$BR" -d "$cidr" -j DROP
done
# Traffic to the host itself (its gateway IP, anything listening on it). DNS still works: Docker's resolver lives inside the container.
iptables -I INPUT -i "$BR" -j DROP
```

Then check from a shell container: `curl -m 3 http://169.254.169.254/` must time out, and `pip install requests` must still work.

- The rules are not persistent. Re-apply them at boot (for example with `iptables-persistent` or a systemd unit ordered after `docker.service`).
- Recreating the network changes its id, and so the `br-` interface name. Re-run the script after `docker network rm`.
- If Docker has IPv6 enabled, add the matching `ip6tables` rules (`fe80::/10`, `fc00::/7`, and the instance metadata address if your cloud has one).

## Stronger isolation

Set `SANDBOX_RUNTIME=runsc` to run shell containers under [gVisor](https://gvisor.dev) once it is installed and registered with Docker. Containers are recreated on the next connect after an idle stop, so a changed runtime or network applies without manual cleanup.

## File endpoint

`PUT /api/sandbox/files/:name` writes one file into the learner's sandbox home, and `GET /api/sandbox/files?dir=<rel>` lists a folder there. Only `solution.py` and `solution.js` can be written, with content up to 4000 characters (16 KiB is only the request body limit). A listing returns at most 200 entries and sets `truncated` when there are more. `dir` is up to four plain segments, with no `.` or `..`.

- The endpoints never create or start a sandbox. Without an open shell they answer `409 no_shell`, so the editor opens the terminal first.
- `501 not_implemented` means the active backend has no file support.
- Docker writes and lists as uid 1001 (the `learner` user), so the files belong to the shell user. On Daytona the home is the sandbox user's home (`/home/learner` if the SDK reports none).
- Daytona writes check the target first: if `<home>/<name>` is a symlink or not a regular file it is deleted (a delete does not follow links) before the upload, so a learner-made `ln -sf /etc/passwd ~/solution.py` is not followed by a toolbox running as root. A TOCTOU window remains between that check and the upload. The real fix is to confirm the Daytona toolbox runs as the `learner` user; this needs a real Daytona key and is a manual pre-release check. Also confirm there that `getFileDetails` reports `mode` in the symbolic form (a symlink starts with `L`) and does not follow links; if it returns octal modes or stats through the link, the symlink check above does not detect anything.
- A missing or non-directory folder answers 404. On Daytona a missing folder is a 404 from the SDK; a file path is confirmed with a second `getFileDetails` call (`isDir === false`). If that call also fails, the original error is surfaced as a failure.
