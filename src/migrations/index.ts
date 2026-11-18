import * as migration_20261118_005033_initial from './20261118_005033_initial';
import * as migration_20261118_005045_add_registration_constraints from './20261118_005045_add_registration_constraints';
import * as migration_20261118_101916_add_overlap_guard from './20261118_101916_add_overlap_guard';

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
  {
    up: migration_20261118_101916_add_overlap_guard.up,
    down: migration_20261118_101916_add_overlap_guard.down,
    name: '20261118_101916_add_overlap_guard',
  },
];
