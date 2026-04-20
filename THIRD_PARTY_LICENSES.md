# Third-Party Licenses

This file lists direct runtime dependencies only.
Dev/build/test dependencies are intentionally excluded in this document.

License types below were verified from official package sources (PyPI, npm, and
upstream repositories), and each entry includes a reference to the upstream
license file.

---

## Backend (Python)

### fastapi

- Version used: `>=0.116.1,<1.0`
- License: MIT
- Copyright notice: Copyright (c) 2018 Sebastián Ramírez
- Official source: https://pypi.org/project/fastapi/
- License reference: https://github.com/fastapi/fastapi/blob/master/LICENSE

### uvicorn

- Version used: `uvicorn[standard]==0.42.0`
- License: BSD-3-Clause
- Copyright notice: Copyright (c) 2017-present Encode OSS Ltd
- Official source: https://pypi.org/project/uvicorn/
- License reference: https://github.com/Kludex/uvicorn/blob/master/LICENSE.md

### python-multipart

- Version used: `==0.0.22`
- License: Apache-2.0
- Copyright notice: See upstream license file
- Official source: https://pypi.org/project/python-multipart/
- License reference: https://github.com/Kludex/python-multipart/blob/master/LICENSE.txt

### SQLAlchemy

- Version used: `==2.0.48`
- License: MIT
- Copyright notice: Copyright (C) 2005-2026 the SQLAlchemy authors and contributors
- Official source: https://pypi.org/project/SQLAlchemy/
- License reference: https://github.com/sqlalchemy/sqlalchemy/blob/main/LICENSE

### bcrypt

- Version used: `==5.0.0`
- License: Apache-2.0
- Copyright notice: See upstream license file
- Official source: https://pypi.org/project/bcrypt/
- License reference: https://github.com/pyca/bcrypt/blob/main/LICENSE

### Pillow

- Version used: `==12.1.1`
- License: MIT-CMU (PIL-style)
- Copyright notice:
	- Copyright (c) 1997-2011 Secret Labs AB
	- Copyright (c) 1995-2011 Fredrik Lundh and contributors
	- Copyright (c) 2010 Pillow contributors
- Official source: https://pypi.org/project/pillow/
- License reference: https://github.com/python-pillow/Pillow/blob/main/LICENSE

### litellm

- Version used: `==1.83.10`
- License: MIT (with repository-specific carve-out for `enterprise/` directory)
- Copyright notice: Copyright (c) 2023 Berri AI
- Official source: https://pypi.org/project/litellm/
- License reference: https://github.com/BerriAI/litellm/blob/main/LICENSE
- Note: Non-standard project structure. The upstream license file states content
	under `enterprise/` (if present) is separately licensed.

### httpx

- Version used: `>=0.28.0`
- License: BSD-3-Clause
- Copyright notice: See upstream license file
- Official source: https://pypi.org/project/httpx/
- License reference: https://github.com/encode/httpx/blob/master/LICENSE.md

### slowapi

- Version used: `>=0.1.9`
- License: MIT
- Copyright notice: See upstream license file
- Official source: https://pypi.org/project/slowapi/
- License reference: https://github.com/laurents/slowapi/blob/master/LICENSE

---

## Frontend (JavaScript/TypeScript)

### @tabler/icons-react

- Version used: `^3.41.0`
- License: MIT
- Copyright notice: Copyright (c) 2020-2024 Paweł Kuna
- Official source: https://www.npmjs.com/package/@tabler/icons-react
- License reference: https://github.com/tabler/tabler-icons/blob/master/LICENSE

### @uiw/react-color-sketch

- Version used: `^2.10.1`
- License: MIT
- Copyright notice: Copyright (c) 2021 uiw
- Official source: https://www.npmjs.com/package/@uiw/react-color-sketch
- License reference: https://github.com/uiwjs/react-color/blob/master/LICENSE

### clsx

- Version used: `^2.1.1`
- License: MIT
- Copyright notice: See upstream license file
- Official source: https://www.npmjs.com/package/clsx
- License reference: https://github.com/lukeed/clsx/blob/master/license

### lucide-react

- Version used: `^0.577.0`
- License: ISC
- Copyright notice: See upstream license file
- Official source: https://www.npmjs.com/package/lucide-react
- License reference: https://github.com/lucide-icons/lucide/blob/main/LICENSE

### react

- Version used: `^19.2.4`
- License: MIT
- Copyright notice: Copyright (c) Meta Platforms, Inc. and affiliates
- Official source: https://www.npmjs.com/package/react
- License reference: https://github.com/facebook/react/blob/main/LICENSE

### react-dom

- Version used: `^19.2.4`
- License: MIT
- Copyright notice: Copyright (c) Meta Platforms, Inc. and affiliates
- Official source: https://www.npmjs.com/package/react-dom
- License reference: https://github.com/facebook/react/blob/main/LICENSE

### react-router-dom

- Version used: `^7.13.1`
- License: MIT
- Copyright notice: See upstream license file
- Official source: https://www.npmjs.com/package/react-router-dom
- License reference: https://github.com/remix-run/react-router/blob/main/LICENSE.md
