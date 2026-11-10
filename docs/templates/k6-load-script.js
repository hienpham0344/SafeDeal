// ==============================================================================
// Grafana k6 Production Load & Stress Benchmark Template
// ==============================================================================

import http from 'k6/http';
import { check, sleep, group } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Warm-up ramp
    { duration: '1m', target: 100 },   // Sustained high load
    { duration: '30s', target: 200 },  // Peak stress test
    { duration: '30s', target: 0 },    // Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<400', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://api.example.com';

export default function () {
  group('Health & Readiness', () => {
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'status is 200': (r) => r.status === 200,
    });
  });

  group('Core API Flow', () => {
    const params = {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'k6-load-test',
      },
    };
    const res = http.get(`${BASE_URL}/api/v1/items?limit=20`, params);
    check(res, {
      'items returned successfully': (r) => r.status === 200,
      'response time < 400ms': (r) => r.timings.duration < 400,
    });
  });

  sleep(1);
}
