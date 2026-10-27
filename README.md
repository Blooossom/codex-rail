# Codex Rail

기존 Codex CLI 입력창 아래에 작은 열차를 표시하는 플러그인입니다. 최초 설정으로 zsh 또는 Windows PowerShell에 실행 연동을 설치하면 평소처럼 `codex`를 입력하면 됩니다. 내부적으로 공식 CLI와 별도의 표시용 프로세스를 실행하며, Codex 자체의 TUI 코드는 수정하지 않습니다.

```sh
codex
codex -m gpt-6-astra
codex resume --last
codex resume --last --yolo
node src/cli.mjs --demo  # 이 폴더에서 실행하는 데모
```

- ASTRA 보라색 / SOL 호박색 명판은 현재 설정된 모델을 나타냅니다.
- 승객 수와 객차 내부의 %는 최근 모델 호출의 컨텍스트 사용률입니다. 누적 토큰 사용량을 사용하지 않습니다.
- 열차 위치는 주간 사용 한도에만 연결됩니다. 선로의 현재 진행 지점에는 주간 잔여 %만 표시합니다. 5시간 한도는 표시하지 않습니다.
- Fast 모드는 증기, 입력·승인 대기는 노란 신호등, 완료는 깃발, 오류는 빨간 `!`로 표시합니다. 요청을 보낸 뒤 답변이 끝날 때까지 바퀴가 계속 회전하며, 중간 도구 실행·승인 대기·컨텍스트 압축에서도 회전을 유지합니다. 완료·중단·오류 시 멈춥니다.
- 열차 앞뒤에는 흐린 산과 작은 나무를 표시합니다. 열차 주변 여백을 유지하며, 창이 좁으면 풍경을 줄이거나 숨깁니다.
- 컨텍스트 압축 중에는 객차 문이 열리고 승객이 내리는 표현을 보여줍니다. 실제 승객 수는 새 토큰 이벤트를 받은 뒤 바뀝니다.
- 종점 위에는 주간 초기화까지 남은 시간이 나옵니다. 데이터가 없으면 `↻ --`, 초기화 시각이 지났지만 갱신되지 않았으면 `↻ pending`을 표시합니다.

## GitHub 마켓플레이스에서 설치

공통으로 Node 22 이상, Python 3.11 이상, 로그인된 Codex CLI가 필요합니다. 개발 환경은 Codex CLI 0.164.0입니다. 런타임의 WebSocket 의존성은 `vendor/ws`에 라이선스와 함께 포함돼 있습니다.

| 환경 | 추가 요구사항 | 지원 범위 |
| --- | --- | --- |
| macOS + zsh | tmux, 로컬 app-server daemon | 실제 터미널 검증 완료 |
| Windows PowerShell 5.1 / PowerShell 7 | Windows Terminal (`wt.exe`), native Codex CLI | 0.3.1 실험 지원. 자동 테스트 대상이며 실제 Windows Terminal 화면은 미검증 |
| Linux + zsh | tmux, 로컬 app-server daemon | 자동 테스트 대상. 실제 사용은 미검증 |

Windows에서 WSL이나 tmux는 필요하지 않습니다. ZIP 다운로드나 `npm install` 없이 아래 명령으로 설치할 수 있습니다.

```sh
codex plugin marketplace add Blooossom/codex-rail
codex plugin add codex-rail@blossom-local
```

설치 후 새 Codex 세션에서 **`/hooks` → `SessionStart` → `Codex Rail: automatic shell setup`**을 선택하세요. 출처가 `Plugin - codex-rail@blossom-local`이고 명령에 `auto-setup.mjs`가 있는지 검토한 뒤 훅을 신뢰합니다. 그 다음 새 Codex 세션을 시작하면 필요한 셸 연동을 자동으로 설치하고, 완료 안내가 나옵니다. **새 터미널 탭**에서 `codex`를 실행하면 열차가 표시됩니다. 이후에는 기존 연동을 확인하고 버전 업데이트 시 실행 경로를 갱신합니다.

0.3.0은 Codex 0.164.0에서 플러그인 훅이 목록에 나타나지 않는 문제가 있었습니다. 0.3.1은 `.codex-plugin/plugin.json` 호환 형식을 사용해 이를 수정합니다. `Unnamed hook`이 보인다는 이유만으로 신뢰를 바꾸지 말고 출처와 명령을 확인하세요. `PermissionRequest`에는 이 자동 설정 훅이 없습니다.

Codex는 사용자가 신뢰하지 않은 훅을 실행하지 않습니다. **`plugin add`만 실행하거나 훅을 신뢰하지 않은 상태에서는 셸 연동이 자동 설치되지 않습니다.** 훅을 사용하지 않으려면 새 Codex 세션에서 **“Codex Rail setup 스킬로 터미널 연동을 설치하고 상태까지 확인해줘”**라고 요청하거나 아래 수동 명령을 사용하세요. `/plugins` 활성화나 자동 설정으로 이미 실행 중인 부모 셸의 명령 해석이 바뀌지는 않습니다. [공식 훅 신뢰 안내](https://learn.chatgpt.com/docs/hooks)

자동 설정은 시스템 패키지를 설치하지 않습니다. tmux·Node·Python 등이 없으면 필요한 조치를 안내합니다. Windows에서는 설치된 PowerShell 5.1과 7의 ConsoleHost 프로필을 설정하며, 다른 호스트용 프로필은 아래 수동 설정을 사용합니다. 자동 설정만 끄려면 `CODEX_RAIL_AUTO_SETUP_DISABLE=1`을 환경 변수로 지정하세요.

제거 스크립트로 연동을 제거하면 자동 설정도 중지해 다음 세션에서 다시 설치하지 않습니다. 수동 설치를 다시 실행하면 자동 설정을 재개합니다.

수동으로 설정하려면 `codex plugin add codex-rail@blossom-local --json`의 출력에서 `installedPath`를 확인한 뒤 해당 폴더에서 `python3 scripts/setup.py --install`과 `python3 scripts/setup.py --status`를 실행합니다. GitHub 저장소를 직접 복제할 필요는 없습니다. `blossom-local`은 이 저장소의 마켓플레이스 식별자입니다.

### macOS + zsh: 설치됐는데 열차가 안 나올 때

아래 명령을 zsh에서 실행하세요. `tmux is required` 오류가 나오면 `brew install tmux` 후 다시 실행합니다. Node 22 이상과 Python 3.11 이상도 필요합니다.

```sh
rail_root=$(codex plugin add codex-rail@blossom-local --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["installedPath"])')
python3 "$rail_root/scripts/setup.py" --install
python3 "$rail_root/scripts/setup.py" --status
source "${XDG_CONFIG_HOME:-$HOME/.config}/codex-rail/integration.zsh"
codex
```

상태 출력이 `"configured": true`여야 합니다. 터미널 높이가 20줄 미만이면 기본 Codex로 전달하므로 창을 키워 주세요. 기존 `codex` 별칭이나 함수가 있으면 설정이 중단됩니다. 기존 설정을 임의로 지우지 말고 오류 내용을 확인하세요.

### Windows PowerShell: 수동 설정

Windows Terminal, Node 22+, Python 3.11+, native Codex CLI를 준비하고 로그인하세요. **앞으로 사용할 PowerShell 버전에서** 다음을 실행합니다. PowerShell 5.1과 7은 서로 다른 프로필을 사용하므로 각 환경에서 별도로 설정합니다.

```powershell
$rail = codex plugin add codex-rail@blossom-local --json | ConvertFrom-Json
& (Join-Path $rail.installedPath 'scripts\setup.ps1') -Install -ProfilePath $PROFILE.CurrentUserCurrentHost
& (Join-Path $rail.installedPath 'scripts\setup.ps1') -Status -ProfilePath $PROFILE.CurrentUserCurrentHost
. (Join-Path $env:APPDATA 'codex-rail\integration.ps1')
codex
```

`codex`를 실행하면 새 Windows Terminal 창에 Codex와 열차가 위아래로 표시됩니다. 원래 PowerShell은 해당 실행이 끝날 때까지 기다립니다. 열차 영역은 처음에 약 6줄이며 창 크기 변경 시 분할 비율을 따릅니다. 대화는 위쪽 창에서 스크롤합니다. Codex를 종료하면 열차도 종료됩니다. PowerShell 실행 정책이 스크립트를 막으면 해당 정책에 맞게 서명 또는 허용된 배포 경로를 사용해야 하며, 설치 스크립트는 정책을 변경하거나 우회하지 않습니다.

Windows에서 일시 중지하려면 `$env:CODEX_RAIL_DISABLE = '1'`을 설정하고, 다시 켜려면 `Remove-Item Env:\CODEX_RAIL_DISABLE`을 실행합니다. 완전히 제거할 때는 설치된 `setup.ps1`에 `-Remove -ProfilePath $PROFILE.CurrentUserCurrentHost`를 전달한 뒤 플러그인을 제거하고 새 PowerShell 탭을 엽니다.

### 업데이트

```sh
codex plugin marketplace upgrade blossom-local
codex plugin add codex-rail@blossom-local
```

업데이트 후 새 Codex 세션에서 **“Codex Rail 설정해줘”**라고 다시 요청하고 새 터미널 탭을 여세요. 설치 경로가 바뀌어도 셸 연동이 새 버전을 가리키도록 갱신합니다. 실행 중인 세션은 종료하고 다시 실행합니다.

### 로컬 폴더에서 설치

개발용 체크아웃이나 아래 테스트 ZIP을 사용한다면, 압축을 푼 프로젝트 폴더에서 GitHub 주소 대신 로컬 경로를 등록할 수 있습니다.

```sh
codex plugin marketplace add "$PWD"
codex plugin add codex-rail@blossom-local
python3 scripts/setup.py --install
python3 scripts/setup.py --status
```

같은 이름의 마켓플레이스를 로컬 경로로 이미 등록했다면 기존 연동과 플러그인을 제거하고 `codex plugin marketplace remove blossom-local`로 이전 소스를 제거한 뒤 GitHub 소스를 등록하세요. 기존 로컬 폴더는 새 설치와 연동 설정을 마친 뒤 삭제합니다.

## 실행 및 표시

macOS/zsh에서는 최소 높이 20줄, 권장 너비 80칸이며 열차는 6줄을 사용합니다. 작은 창에서는 간단한 열차로 전환합니다. 일반 Codex처럼 종료하면 열차도 종료됩니다. 래퍼 내부의 tmux에서 `Ctrl+B`, `D`를 누르면 이 래퍼 세션도 닫힙니다. 기존 사용자의 tmux 설정과 세션은 건드리지 않습니다. Windows에서는 위의 PowerShell 안내를 따릅니다.

tmux의 대화 영역에서 마우스 휠이나 트랙패드로 위아래로 스크롤하면 이전 대화 출력을 볼 수 있습니다. 맨 아래까지 내리거나 스크롤 모드에서 `q`를 누르면 입력 화면으로 돌아옵니다. 키보드로는 `Ctrl+B`를 누른 다음 `[`를 눌러 스크롤 모드에 들어갈 수 있습니다. 방향키 위·아래는 기존처럼 입력 기록을 탐색합니다. 0.2.0의 휠이 입력 기록을 넘기던 문제는 0.2.1에서 수정했습니다.

`codex exec`, 로그인, 업데이트, 플러그인 관리, 도움말, 버전 조회, 명시적인 원격 연결, 파이프 실행은 원래 Codex로 전달됩니다. `CODEX_RAIL_DISABLE=1 codex` 또는 `command codex`로 일시적으로 우회할 수 있습니다. `/plugins`에서 비활성화하면 다음 실행부터 원래 Codex를 사용합니다. 셸 연동을 완전히 지우려면 `python3 <설치된 플러그인>/scripts/setup.py --remove`를 실행합니다.

`CODEX_RAIL_REDUCED_MOTION=1 codex`로 동작을 줄이고, `NO_COLOR=1 codex`로 색을 끌 수 있습니다. 플러그인 설정은 `codex-rail`이라는 별도 명령을 PATH에 추가하지 않습니다.

데모 키: `1` 작업, `2` 승인 대기, `3` 완료, `4` 오류, `5` 압축, `m` 모델 변경, `f` Fast 전환, `q` 종료. 데모는 가상 데이터이며 모델을 호출하지 않습니다.

## 소규모 테스트 배포 (0.3.1)

아래 ZIP 설치 안내는 macOS + zsh용입니다. Windows는 위 PowerShell 설치 안내를 따르세요. 개발 환경의 Codex CLI는 0.164.0이며 다른 버전의 호환성은 별도 확인이 필요합니다. Node 22 이상, Python 3.11 이상, tmux와 로그인된 Codex CLI를 준비하세요. WebSocket 라이브러리가 포함돼 있어 `npm install`은 필요하지 않습니다.

### 받는 사람: 설치

전달받은 `codex-rail-0.3.1-test.zip`을 압축 해제한 뒤 `codex-rail-0.3.1` 폴더를 계속 보관할 위치로 옮기세요. 아래 명령은 그 폴더에서 실행합니다. 경로에 공백이 있어도 됩니다. 설치 후 폴더를 옮기거나 삭제하면 셸 연동을 다시 설정해야 합니다.

```sh
node --version
python3 --version
tmux -V
codex --version
codex app-server daemon --help

# 가상 데이터로 먼저 화면 확인: q로 종료
node src/cli.mjs --demo

# 로컬 마켓플레이스 등록 및 플러그인 설치
codex plugin marketplace add "$PWD"
codex plugin add codex-rail@blossom-local

# 이 폴더의 실행 파일을 사용하는 zsh 연동 설치
python3 scripts/setup.py --install
python3 scripts/setup.py --status
```

설정은 `.zshrc`에 Codex Rail 블록을 추가하며, 기존 파일이 있으면 백업을 만듭니다. `ZDOTDIR`을 사용하는 경우 해당 폴더의 `.zshrc`가 대상입니다. 새 터미널 탭에서 `codex`를 실행하면 열차가 표시됩니다. 창은 최소 20줄, 권장 80칸 이상으로 열어 주세요. 기존 `codex` 별칭이나 함수가 있으면 설치가 중단되므로 오류 내용을 제작자에게 알려 주세요.

### 확인할 항목과 피드백

- 새 탭에서 `codex` 실행 시 입력창과 열차가 함께 표시되는지.
- 짧은 요청 한 번 후 작업 상태와 컨텍스트 수치가 바뀌는지. 실제 요청은 평소처럼 계정 사용량을 소모합니다.
- `codex resume --last`로 재개하고 창 크기를 바꿔도 화면이 유지되는지.
- `codex --version`, `codex exec --help`가 정상 작동하는지.
- Codex를 종료했을 때 원래 셸로 돌아오는지.

문제를 전달할 때는 배포 버전, macOS 버전, 터미널 앱, 위 네 가지 버전 명령의 출력, 재현 순서, 기대한 결과와 실제 결과를 함께 적어 주세요. 스크린샷에는 개인 대화나 프로젝트 정보가 보이지 않도록 해 주세요. 피드백은 ZIP을 전달한 사람에게 보내면 됩니다.

### 일시 중지 및 제거

```sh
# 이번 실행만 기본 Codex 사용
CODEX_RAIL_DISABLE=1 codex

# 압축 해제한 플러그인 폴더에서 연동 제거 후 플러그인 제거
python3 scripts/setup.py --remove
codex plugin remove codex-rail@blossom-local
```

제거 후 새 터미널 탭을 열어 주세요. 이미 열린 탭의 함수까지 즉시 지우려면 `unfunction codex`를 실행합니다. `blossom-local`에 다른 플러그인이 없다면 `codex plugin marketplace remove blossom-local`로 마켓플레이스도 제거할 수 있습니다. 그 다음 압축 해제한 폴더를 삭제합니다.

### 만드는 사람: 배포 파일 생성

```sh
npm test
python3 -m unittest discover -s test -p 'test_*.py'
python3 scripts/package.py
```

`dist/codex-rail-0.3.1-test.zip`과 같은 이름의 `.zip.sha256` 파일을 테스트 참여자에게 함께 전달합니다. ZIP에는 실행 코드, 설치 스킬, 마켓플레이스 정보, 안내, 기존 테스트와 `ws` 라이선스가 들어갑니다. `node_modules`, Python 캐시, 로그, 개인 설정은 포함하지 않습니다. 체크섬은 두 파일이 있는 폴더에서 `shasum -a 256 -c codex-rail-0.3.1-test.zip.sha256`으로 확인할 수 있습니다.

다음 배포에서는 `.codex-plugin/plugin.json`, `package.json`, `package-lock.json`의 버전을 함께 올리고 위 안내의 버전과 파일 이름도 갱신하세요. 참여자는 이전 연동과 플러그인을 제거한 뒤 새 폴더에서 다시 설치합니다.

이 ZIP은 소규모 수동 설치 테스트용입니다. 마켓플레이스 구조는 [공식 플러그인 패키징 문서](https://developers.openai.com/plugins/build/plugins)를 참고합니다.

## 실제 데이터 연결

공식 CLI의 `--remote unix://…` 연결을 로컬 private Unix socket으로 받아, 기존 Codex daemon의 Unix WebSocket에 전달합니다. 일반 요청과 응답은 그대로 전달합니다. 단, Codex 0.164의 원격 TUI는 재개·분기 시 권한 CLI 옵션을 거부하므로, `resume`/`fork`에 명시된 `--yolo`(또는 긴 별칭)는 최초 해당 API 요청의 `approvalPolicy: never`, `sandbox: danger-full-access`로 전달합니다. 서버 응답에서 실제 적용을 확인한 경우에만 재개 성공을 전달합니다. 옵션이 없으면 권한을 바꾸지 않으며, 이후 `/resume`이나 사용자의 권한 변경에 다시 강제하지 않습니다. 사용자 승인 요청과 결정은 공식 Codex UI에서만 처리됩니다.

열차는 해당 CLI가 선택한 스레드의 모델·서비스 티어·토큰·턴·승인 이벤트만 관찰합니다. 주간 한도와 초기화 시간은 `account/rateLimits/read`로 시작 시 및 60초마다 읽고, 사용량 갱신 알림도 반영합니다. `windowDurationMins=10080`인 창만 주간 한도로 취급합니다.

CLI가 제목 생성용으로 여는 `thread_title` 같은 내부 스레드는 표시 대상으로 선택하지 않습니다. 이 구분이 없던 초기 테스트본에서는 제목 생성 후 모델이 LUNA, 컨텍스트가 약 3%로 고정되는 문제가 있었습니다. 수정본 적용 후에는 Codex Rail 세션을 한 번 종료하고 다시 실행해야 합니다.

대화 로그, 응답, 인증 정보, 도구 출력은 기록하지 않습니다. 표시용 최소 상태와 실행 인자 등 세션 시작 정보는 임시 디렉터리에 저장하고 종료 시 지웁니다. macOS/Linux는 디렉터리 0700 및 파일 0600 권한의 Unix socket을 사용하며 TCP 포트를 열지 않습니다.

Windows는 현재 사용자만 접근할 수 있도록 ACL을 제한한 임시 디렉터리를 사용합니다. Codex app-server를 해당 실행의 stdio 자식 프로세스로 시작하고, TUI는 임의 포트의 `127.0.0.1` WebSocket으로 연결합니다. 매 실행 생성하는 토큰이 있는 연결만 허용하며 토큰은 파일이나 명령행에 쓰지 않고 TUI 자식의 환경 변수로 전달합니다. 모든 플랫폼에서 브라우저 Origin이 있는 연결을 거부하고, 승인 요청과 사용자의 결정은 그대로 전달합니다. Windows Terminal의 분할 창은 [Microsoft 공식 명령행 인터페이스](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)를 사용합니다.

컨텍스트 비율은 `last.totalTokens / modelContextWindow`이므로 Codex 기본 표시의 예약 용량·반올림 방식과 차이가 날 수 있습니다. 승객 한 명은 최대 10%를 나타내며 수치는 객차 안에 표시합니다. 새 세션이나 재개 직후에는 첫 토큰 이벤트 전까지 컨텍스트가 `--`일 수 있습니다. 모델 변경은 서버에서 확인된 설정을 기준으로 표시합니다. 서버가 보고하는 모델이 바뀌면 CLI 기본 상태줄과 명판이 다를 수 있습니다. ASTRA·SOL 외 모델은 회색의 짧은 명판으로 표시합니다.

사용하는 app-server transport는 실험적 기능이므로 Codex 업데이트 때 호환성을 확인해야 합니다. [공식 app-server 문서](https://learn.chatgpt.com/docs/app-server)

## 검증

```sh
npm test
python3 -m unittest discover -s test -p 'test_*.py'
```

주간 한도 선택, 스레드 분리, 토큰 계산, 상태 전이, 모델 및 Fast 변경, 화면 너비, 요청 전달과 승인 비개입을 검증합니다.

Windows 자동 테스트는 PowerShell 5.1과 7에서 임시 프로필의 설치·백업·제거, 빈 값·따옴표·한글을 포함한 인자 보존, 기본 명령·파이프 전달을 확인합니다. 별도로 loopback 인증, 브라우저 거부, stdio 연결과 종료를 검증합니다. 실제 Windows Terminal GUI에서의 분할 화면·크기 변경·종료·실제 Codex 사용은 수동 확인이 남아 있습니다.
