const environments = {
  live: { name: 'Live', tone: 'live' },
  production: { name: 'Production', tone: 'live' },
  prod: { name: 'Production', tone: 'live' },
  staging: { name: 'Staging', tone: 'staging' },
  stage: { name: 'Staging', tone: 'staging' },
  development: { name: 'Development', tone: 'dev' },
  dev: { name: 'Development', tone: 'dev' },
  test: { name: 'Test', tone: 'test' },
  testing: { name: 'Test', tone: 'test' },
};

export default function EnvironmentBadge({ environment }) {
  const value = typeof environment === 'string' ? environment.trim() : '';
  const key = value.toLowerCase();
  const entry = Object.prototype.hasOwnProperty.call(environments, key) ? environments[key] : null;
  const name = entry?.name || (value ? value.replace(/[_-]+/g, ' ') : 'Unknown environment');

  return <span className={`ui-badge ui-environment-badge ui-environment--${entry?.tone || 'unknown'}`}>{name}</span>;
}
