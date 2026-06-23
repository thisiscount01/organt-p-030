import requests

base = 'http://localhost:3000'

r = requests.get(f'{base}/api/books?limit=1000')
d = r.json()
total = d.get('total', len(d.get('data', [])))
print(f'[①] 도서 수: {total}권 — {"PASS" if total >= 200 else "FAIL"}')

r2 = requests.post(f'{base}/api/auth/register', json={'username':'qabot2','email':'qabot2@bw.com','password':'Qa123456!'})
token = r2.json().get('token','')
print(f'[②-1] 회원가입: {"PASS" if token else "FAIL"}')

r3 = requests.post(f'{base}/api/auth/login', json={'email':'qabot2@bw.com','password':'Qa123456!'})
token = r3.json().get('token', token)
print(f'[②-2] 로그인: {"PASS" if token else "FAIL"}')

r4 = requests.get(f'{base}/api/auth/me', headers={'Authorization': f'Bearer {token}'})
print(f'[②-3] /me 인증: {"PASS" if r4.status_code==200 else "FAIL"}')

r5 = requests.post(f'{base}/api/posts', json={'title':'익명','content':'내용'})
print(f'[②-4] 비로그인 차단: {"PASS" if r5.status_code==401 else "FAIL"} ({r5.status_code})')

r6 = requests.post(f'{base}/api/posts', json={'title':'QA테스트','content':'본문'}, headers={'Authorization': f'Bearer {token}'})
print(f'[②-5] 로그인 글쓰기: {"PASS" if r6.status_code==201 else "FAIL"} ({r6.status_code})')

r7 = requests.post(f'{base}/api/auth/logout', headers={'Authorization': f'Bearer {token}'})
print(f'[②-6] 로그아웃: {"PASS" if r7.status_code==200 else "FAIL"}')
