# PlayCode.gg 운영 절차서 (Runbook)

## 목차
1. [배포 절차](#1-배포-절차)
2. [롤백 절차](#2-롤백-절차)
3. [장애 대응](#3-장애-대응)
4. [모니터링 확인](#4-모니터링-확인)
5. [DB 운영](#5-db-운영)
6. [인프라 관리](#6-인프라-관리)

---

## 1. 배포 절차

### 1.1 자동 배포 (CI/CD)
```bash
# main 브랜치에 푸시하면 GitHub Actions가 자동 실행
git push origin main

# 파이프라인 흐름: Lint → Security Scan → Build → Deploy
# production 환경에 승인 게이트가 설정된 경우 수동 승인 필요
```

### 1.2 수동 배포
```bash
# 1. ECR에 이미지 빌드 & 푸시
docker build -t 925216255375.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:TAG .
docker push 925216255375.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:TAG

# 2. 이미지 업데이트
kubectl set image deployment/playcode-app \
  playcode-app=925216255375.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:TAG \
  -n playcode

# 3. 배포 상태 확인
kubectl rollout status deployment/playcode-app -n playcode --timeout=300s
```

### 1.3 배포 후 검증
```bash
# 헬스체크
kubectl exec deployment/playcode-app -n playcode -- wget -qO- http://localhost:3000/health

# 로그 확인
kubectl logs deployment/playcode-app -n playcode --tail=50

# Pod 상태 확인
kubectl get pods -n playcode -l app=playcode-app
```

---

## 2. 롤백 절차

### 2.1 즉시 롤백 (직전 버전)
```bash
# 롤백 실행
kubectl rollout undo deployment/playcode-app -n playcode

# 롤백 상태 확인
kubectl rollout status deployment/playcode-app -n playcode --timeout=120s
```

### 2.2 특정 버전으로 롤백
```bash
# 배포 히스토리 확인
kubectl rollout history deployment/playcode-app -n playcode

# 특정 리비전으로 롤백
kubectl rollout undo deployment/playcode-app -n playcode --to-revision=N
```

### 2.3 특정 이미지 태그로 롤백
```bash
# ECR에서 이전 이미지 태그 확인
aws ecr describe-images --repository-name playcode-app \
  --query 'imageDetails | sort_by(@, &imagePushedAt) | [-5:].[imageTags[0], imagePushedAt]' \
  --output table

# 해당 태그로 업데이트
kubectl set image deployment/playcode-app \
  playcode-app=925216255375.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:COMMIT_SHA \
  -n playcode
```

---

## 3. 장애 대응

### 3.1 Pod CrashLoopBackOff
```bash
# 1. Pod 상태 확인
kubectl get pods -n playcode
kubectl describe pod POD_NAME -n playcode

# 2. 로그 확인 (이전 컨테이너 포함)
kubectl logs POD_NAME -n playcode --previous

# 3. 리소스 부족 여부 확인
kubectl top pods -n playcode
kubectl describe node

# 4. 임시 조치: 리소스 제한 상향 또는 롤백
kubectl rollout undo deployment/playcode-app -n playcode
```

### 3.2 높은 응답 지연시간
```bash
# 1. Grafana 대시보드에서 p95/p99 확인
#    URL: https://grafana.playcode.gg/d/playcode-app

# 2. Pod CPU/메모리 확인
kubectl top pods -n playcode

# 3. MongoDB 슬로우 쿼리 확인
kubectl exec -it mongodb-0 -n playcode -- mongosh --eval "db.currentOp({'secs_running': {'\$gte': 3}})"

# 4. Redis 메모리 상태 확인
kubectl exec -it deployment/redis -n playcode -- redis-cli info memory

# 5. HPA 스케일링 상태 확인
kubectl get hpa -n playcode
```

### 3.3 MongoDB 장애
```bash
# 1. Pod 상태 확인
kubectl get pods -n playcode -l app=mongodb

# 2. MongoDB 상태 확인
kubectl exec -it mongodb-0 -n playcode -- mongosh --eval "rs.status()"
kubectl exec -it mongodb-0 -n playcode -- mongosh --eval "db.serverStatus()"

# 3. PVC 상태 확인
kubectl get pvc -n playcode

# 4. 디스크 사용량 확인
kubectl exec -it mongodb-0 -n playcode -- df -h /data/db
```

### 3.4 Redis 장애
```bash
# 1. Redis 연결 확인
kubectl exec -it deployment/redis -n playcode -- redis-cli ping

# 2. 상세 상태 확인
kubectl exec -it deployment/redis -n playcode -- redis-cli info

# 3. AOF 파일 상태 확인
kubectl exec -it deployment/redis -n playcode -- redis-cli info persistence

# 4. 메모리 사용량 초과 시
kubectl exec -it deployment/redis -n playcode -- redis-cli info memory
kubectl exec -it deployment/redis -n playcode -- redis-cli dbsize
```

### 3.5 WebSocket 연결 문제
```bash
# 1. Grafana에서 WebSocket 연결 수 확인
#    메트릭: websocket_connections_active

# 2. Ingress 설정 확인 (WebSocket 프록시 타임아웃)
kubectl get ingress -n playcode -o yaml

# 3. Pod 로그에서 소켓 에러 확인
kubectl logs deployment/playcode-app -n playcode | grep -i "socket"

# 4. Redis Adapter 상태 확인
kubectl logs deployment/playcode-app -n playcode | grep -i "redis"
```

---

## 4. 모니터링 확인

### 4.1 Grafana 접속
```
URL: https://grafana.playcode.gg
대시보드:
  - PlayCode - Application Metrics
  - PlayCode - Infrastructure
  - PlayCode - Database Metrics
```

### 4.2 Prometheus 직접 쿼리
```bash
# 포트포워딩
kubectl port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090 -n monitoring

# 주요 쿼리 예시
# HTTP 5xx 에러율
rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m])

# 응답 시간 p99
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# 현재 WebSocket 연결
websocket_connections_active
```

### 4.3 로그 확인 (Loki)
```
Grafana → Explore → Loki 데이터소스

주요 쿼리:
  {namespace="playcode", container="playcode-app"} |= "error"
  {namespace="playcode"} | json | level="error"
  {namespace="playcode"} | json | res_status >= 500
```

---

## 5. DB 운영

### 5.1 수동 백업
```bash
# MongoDB 백업 CronJob 수동 실행
kubectl create job --from=cronjob/mongodb-backup manual-backup-$(date +%Y%m%d) -n playcode

# 백업 작업 상태 확인
kubectl get jobs -n playcode -l app=mongodb-backup

# 백업 로그 확인
kubectl logs job/manual-backup-YYYYMMDD -n playcode
```

### 5.2 백업 복원
```bash
# 1. S3에서 백업 파일 다운로드
aws s3 cp s3://playcode-backups/mongodb-backups/playcode_backup_TIMESTAMP.gz /tmp/

# 2. 압축 해제
cd /tmp && tar xzf playcode_backup_TIMESTAMP.gz

# 3. 복원 (주의: 기존 데이터 덮어씀)
kubectl cp /tmp/backup_TIMESTAMP mongodb-0:/tmp/restore -n playcode
kubectl exec -it mongodb-0 -n playcode -- mongorestore \
  --host=localhost:27017 \
  --username=admin \
  --password=PASSWORD \
  --authenticationDatabase=admin \
  --drop \
  /tmp/restore
```

### 5.3 MongoDB 인덱스 관리
```bash
# 인덱스 상태 확인
kubectl exec -it mongodb-0 -n playcode -- mongosh userdb --eval "db.getCollectionNames().forEach(c => printjson(db[c].getIndexes()))"

# 슬로우 쿼리 프로파일링 활성화
kubectl exec -it mongodb-0 -n playcode -- mongosh --eval "db.setProfilingLevel(1, { slowms: 100 })"
```

---

## 6. 인프라 관리

### 6.1 Terraform 변경사항 적용
```bash
cd terraform/environments/prod

# 변경사항 미리보기
terraform plan

# 적용
terraform apply

# 상태 확인
terraform state list
```

### 6.2 Sealed Secrets 갱신
```bash
# 새 시크릿 생성 후 암호화
kubectl create secret generic playcode-secrets \
  --namespace=playcode \
  --from-literal=KEY=VALUE \
  --dry-run=client -o yaml | \
  kubeseal --format yaml > k8s/sealed-secret.yaml

# 적용
kubectl apply -f k8s/sealed-secret.yaml
```

### 6.3 인증서 갱신 (Let's Encrypt)
```bash
# 인증서 상태 확인
kubectl get certificate -n playcode

# 인증서 상세 정보
kubectl describe certificate playcode-tls -n playcode

# 수동 갱신 (cert-manager가 자동 갱신하지만 필요 시)
kubectl delete certificate playcode-tls -n playcode
# cert-manager가 자동으로 재발급
```

### 6.4 ECR 이미지 정리
```bash
# 사용하지 않는 이미지 확인
aws ecr describe-images --repository-name playcode-app \
  --filter tagStatus=UNTAGGED \
  --query 'imageDetails[*].imageDigest'

# 수동 정리 (Lifecycle Policy가 자동 정리하지만 필요 시)
aws ecr batch-delete-image --repository-name playcode-app \
  --image-ids imageDigest=sha256:DIGEST
```

---

## 비상 연락처

| 역할 | 담당 |
|------|------|
| 인프라 관리 | - |
| AWS 계정 | - |
| 도메인 (playcode.gg) | - |

> 이 문서는 인프라 변경 시마다 업데이트해야 합니다.
