#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_BASE_URL:-http://localhost:8080}"
WEB_URL="${FRONTEND_BASE_URL:-http://localhost:5173}"

echo "Checking Backend health at ${API_URL}/api/v1/health..."
HEALTH_JSON="$(curl -fsS --max-time 5 "${API_URL}/api/v1/health")"
echo "Backend health response: $HEALTH_JSON"
echo "$HEALTH_JSON" | grep -q '"status":"UP"'

echo "Checking Backend readiness at ${API_URL}/api/v1/health/ready..."
READY_JSON="$(curl -fsS --max-time 5 "${API_URL}/api/v1/health/ready")"
echo "Backend readiness response: $READY_JSON"
echo "$READY_JSON" | grep -q '"status":"READY"'
echo "$READY_JSON" | grep -q '"databaseConnected":true'

echo "Checking Actuator readiness at ${API_URL}/actuator/health/readiness..."
ACTUATOR_READY_JSON="$(curl -fsS --max-time 5 "${API_URL}/actuator/health/readiness")"
echo "Actuator readiness response: $ACTUATOR_READY_JSON"
echo "$ACTUATOR_READY_JSON" | grep -q '"status":"UP"'

echo "Checking Frontend availability at ${WEB_URL}..."
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${WEB_URL}")"
if [ "$HTTP_CODE" != "200" ]; then
  echo "Error: Frontend returned HTTP $HTTP_CODE" >&2
  exit 1
fi
echo "Frontend HTTP $HTTP_CODE OK"

echo "Checking unauthenticated access control on private endpoints..."
AUTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${API_URL}/api/v1/auth/me")"
if [ "$AUTH_STATUS" != "401" ]; then
  echo "Expected HTTP 401 on unauthenticated /api/v1/auth/me, got $AUTH_STATUS" >&2
  exit 1
fi
echo "Auth boundary check OK (HTTP 401)"

echo "Smoke tests passed cleanly."
