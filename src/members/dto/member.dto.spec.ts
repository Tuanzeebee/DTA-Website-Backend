import { withScheme } from './member.dto';

describe('withScheme', () => {
  it.each([
    ['www.rikkeisoft.com', 'https://www.rikkeisoft.com'],
    [' unitech.vn ', 'https://unitech.vn'],
    ['https://biti.vn', 'https://biti.vn'],
    ['HTTP://a.vn', 'HTTP://a.vn'],
    ['', ''],
    [undefined, undefined],
  ])('%p -> %p', (input, expected) => {
    expect(withScheme(input)).toBe(expected);
  });
});
