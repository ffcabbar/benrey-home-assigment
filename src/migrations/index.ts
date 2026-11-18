import * as migration_20261118_005033_initial from './20261118_005033_initial';
import * as migration_20261118_005045_add_registration_constraints from './20261118_005045_add_registration_constraints';

export const migrations = [
  {
    up: migration_20261118_005033_initial.up,
    down: migration_20261118_005033_initial.down,
    name: '20261118_005033_initial',
  },
  {
    up: migration_20261118_005045_add_registration_constraints.up,
    down: migration_20261118_005045_add_registration_constraints.down,
    name: '20261118_005045_add_registration_constraints',
  },
];
