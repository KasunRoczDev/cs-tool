import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVersionDto } from './repositories.controller';

async function errorsFor(version: any) {
  const dto = plainToInstance(CreateVersionDto, { version });
  return validate(dto);
}

describe('CreateVersionDto.version', () => {
  it.each(['1.7.0', 'v1.7.0', '1.7', '1.7.0-rc.1', '10.20.30'])(
    'accepts %s',
    async (v) => {
      expect(await errorsFor(v)).toHaveLength(0);
    },
  );

  it.each(['abc', '', 'latest', '1.2.3.4', '1', 'v'])(
    'rejects %s instead of silently coercing it to 0.0.0',
    async (v) => {
      const errors = await errorsFor(v);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('matches');
    },
  );
});
