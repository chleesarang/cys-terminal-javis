# 약국 서류 한글 번역본

## 백신 접종 동의서 (Vaccine Administration Consent Form)

Yeh's Pharmacy II (966 S. Western Ave. #103, Los Angeles, CA 90006) 의
영문 백신 접종 동의서를 원본과 동일한 양식으로 한글 번역한 문서.

| 파일 | 용도 |
|---|---|
| `백신접종동의서_Yehs_Pharmacy_II_한글.pdf` | 인쇄·배포용. 폰트 임베드됨 |
| `백신접종동의서_Yehs_Pharmacy_II_한글.docx` | 수정용 (Word) |
| `build_form.py` | 문서 생성 스크립트 |

### 사양
- 용지: US 레터 (8.5 × 11 in), 1페이지
- 여백: 좌우 0.5in / 상 0.42in / 하 0.35in
- 글꼴: 맑은 고딕 (DOCX) — PDF에는 NanumGothic 서브셋 임베드

### 재생성
```bash
pip install python-docx
python3 build_form.py
soffice --headless --convert-to pdf --outdir . <생성된 docx>
```
`soffice` 로 변환하려면 `libreoffice-writer` 패키지가 필요하다.
한글 렌더링에는 `fonts-nanum` 또는 `fonts-noto-cjk` 가 필요하다.

### 주의
번역본은 환자 이해를 돕기 위한 문서다. 법적 효력이나 규제 제출 요건은
약국에서 별도로 확인해야 한다.
