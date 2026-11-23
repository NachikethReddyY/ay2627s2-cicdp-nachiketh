group "default" {
  targets = ["api", "engine"]
}

target "api" {
  context    = "."
  dockerfile = "infra/docker/api.Dockerfile"
  tags       = ["learnquest-ci-api:e2e"]
  cache-from = ["type=gha,scope=e2e-api"]
  cache-to   = ["type=gha,mode=max,scope=e2e-api"]
}

target "engine" {
  context    = "."
  dockerfile = "services/engine/Dockerfile"
  tags       = ["learnquest-ci-engine:e2e"]
  cache-from = ["type=gha,scope=e2e-engine"]
  cache-to   = ["type=gha,mode=max,scope=e2e-engine"]
}
