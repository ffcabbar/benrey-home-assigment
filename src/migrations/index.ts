import * as migration_20261118_005033_initial from './20261118_005033_initial';

export const migrations = [
  {
    up: migration_20261118_005033_initial.up,
    down: migration_20261118_005033_initial.down,
    name: '20261118_005033_initial',
  },
];
