### Fixed

- **Grant limits.** Nobody can give an administrative permission they do not hold: a role keeping administer but not, say, closing the environment can no longer grant itself Administrator, join a group holding it, make a role holding it, issue a service identity a token for it, or enable or erase someone holding it. The last person holding such a permission cannot be removed or disabled.
