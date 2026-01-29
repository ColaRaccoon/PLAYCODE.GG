# Kubernetes 배포 가이드

이 가이드는 PlayCode 애플리케이션을 쿠버네티스에 배포하는 방법을 단계별로 설명합니다.

## 목차
1. [쿠버네티스란?](#쿠버네티스란)
2. [로컬 환경 설정](#로컬-환경-설정)
3. [Docker로 테스트](#docker로-테스트)
4. [로컬 쿠버네티스 배포](#로컬-쿠버네티스-배포)
5. [AWS EKS 배포](#aws-eks-배포)
6. [트러블슈팅](#트러블슈팅)

---

## 쿠버네티스란?

### 도커 vs 쿠버네티스

**도커(Docker)**
- 컨테이너를 **생성하고 실행**하는 도구
- 단일 서버에서 컨테이너 관리
- 예: `docker run`, `docker-compose`

**쿠버네티스(Kubernetes, K8s)**
- 여러 서버에서 도커 컨테이너를 **자동으로 관리**하는 플랫폼
- 로드밸런싱, 자동 복구, 스케일링 등 제공
- 도커로 만든 이미지를 쿠버네티스가 배포/관리

### 핵심 개념

```
┌─────────────────────────────────────────────────────────┐
│                     Cluster (클러스터)                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Namespace (네임스페이스)              │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │        Deployment (배포)                 │   │  │
│  │  │  ┌────────┐  ┌────────┐  ┌────────┐     │   │  │
│  │  │  │  Pod   │  │  Pod   │  │  Pod   │     │   │  │
│  │  │  │ [앱]   │  │ [앱]   │  │ [앱]   │     │   │  │
│  │  │  └────────┘  └────────┘  └────────┘     │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │        Service (서비스)                   │   │  │
│  │  │  [외부 트래픽을 Pod들에게 분산]           │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Pod**: 컨테이너를 실행하는 가장 작은 단위
- **Deployment**: Pod를 여러 개 생성하고 관리 (자동 복구, 롤링 업데이트)
- **Service**: Pod들에게 트래픽을 분산하는 로드밸런서
- **ConfigMap**: 환경 변수 저장
- **Secret**: 비밀번호, API 키 등 민감한 정보 저장
- **Namespace**: 리소스를 논리적으로 분리하는 단위

---

## 로컬 환경 설정

### 1. Docker Desktop 설치 (Windows/Mac)

#### Windows
1. [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop) 다운로드
2. 설치 후 WSL 2 활성화
3. Docker Desktop 실행

#### Mac
1. [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop) 다운로드
2. 설치 후 Docker Desktop 실행

### 2. 쿠버네티스 활성화

Docker Desktop에서 쿠버네티스를 활성화합니다:

1. Docker Desktop 설정 열기 (톱니바퀴 아이콘)
2. **Kubernetes** 탭 클릭
3. **Enable Kubernetes** 체크
4. **Apply & Restart** 클릭
5. 몇 분 기다리면 쿠버네티스가 실행됩니다

### 3. kubectl 설치 확인

```bash
# kubectl 버전 확인
kubectl version --client

# 클러스터 정보 확인
kubectl cluster-info
```

---

## Docker로 테스트

쿠버네티스에 배포하기 전에 먼저 Docker Compose로 테스트합니다.

### 1. 환경 변수 설정

`.env` 파일이 이미 있으므로 그대로 사용합니다.

### 2. Docker Compose로 실행

```bash
# 이미지 빌드 및 컨테이너 실행
docker-compose up --build

# 백그라운드 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 종료
docker-compose down
```

### 3. 테스트

브라우저에서 http://localhost:3000 접속하여 정상 작동 확인

---

## 로컬 쿠버네티스 배포

### 1. Docker 이미지 빌드

```bash
# 이미지 빌드 (로컬 쿠버네티스용)
docker build -t playcode-app:latest .

# 이미지 확인
docker images | grep playcode-app
```

### 2. 매니페스트 파일 수정

`k8s/app-deployment.yaml` 파일에서 이미지를 로컬 이미지로 변경:

```yaml
image: playcode-app:latest  # your-registry/playcode-app:latest 대신
imagePullPolicy: Never      # 로컬 이미지 사용
```

### 3. Secret 생성 (중요!)

**⚠️ k8s/secret.yaml 파일을 직접 수정하지 말고 아래 명령어 사용**

```bash
# Secret 생성
kubectl create secret generic playcode-secrets \
  --from-literal=JWT_SECRET="your-jwt-secret" \
  --from-literal=NAVER_CLIENT_ID="your-naver-client-id" \
  --from-literal=NAVER_CLIENT_SECRET="your-naver-client-secret" \
  --from-literal=GOOGLE_CLIENT_ID="your-google-client-id" \
  --from-literal=GOOGLE_CLIENT_SECRET="your-google-client-secret" \
  --from-literal=ADMIN_SECRET_KEY="your-admin-secret-key" \
  --from-literal=SUPERADMIN_SECRET_KEY="your-superadmin-secret-key" \
  --from-literal=PORTFOLIO_TOKEN="your-portfolio-token" \
  --from-literal=AWS_ACCESS_KEY_ID="your-aws-access-key-id" \
  --from-literal=AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key" \
  --from-literal=AWS_SES_FROM_EMAIL="playcode.gg@gmail.com" \
  --from-literal=S3_BUCKET_NAME="playcode-quiz-images" \
  -n playcode
```

또는 현재 `.env` 파일에서 자동으로 생성:

```bash
# .env 파일에서 Secret 생성 (편리함)
kubectl create secret generic playcode-secrets \
  --from-env-file=.env \
  -n playcode
```

### 4. 네임스페이스 및 리소스 배포

```bash
# 네임스페이스 생성
kubectl apply -f k8s/namespace.yaml

# ConfigMap 생성
kubectl apply -f k8s/configmap.yaml

# MongoDB 배포
kubectl apply -f k8s/mongodb-deployment.yaml

# Redis 배포
kubectl apply -f k8s/redis-deployment.yaml

# 앱 배포
kubectl apply -f k8s/app-deployment.yaml

# Service 배포
kubectl apply -f k8s/app-service.yaml
```

또는 모든 파일을 한 번에 배포:

```bash
kubectl apply -f k8s/
```

### 5. 배포 상태 확인

```bash
# 모든 리소스 확인
kubectl get all -n playcode

# Pod 상태 확인
kubectl get pods -n playcode

# Pod 로그 확인
kubectl logs -f <pod-name> -n playcode

# Service 확인
kubectl get svc -n playcode

# Deployment 상태 확인
kubectl describe deployment playcode-app -n playcode
```

### 6. 애플리케이션 접속

```bash
# Service의 외부 IP 확인 (LoadBalancer 타입)
kubectl get svc playcode-app-service -n playcode

# 로컬에서는 포트 포워딩 사용
kubectl port-forward svc/playcode-app-service 3000:80 -n playcode
```

브라우저에서 http://localhost:3000 접속

### 7. 업데이트 및 롤백

```bash
# 새로운 이미지 빌드
docker build -t playcode-app:v2 .

# Deployment 이미지 업데이트
kubectl set image deployment/playcode-app playcode-app=playcode-app:v2 -n playcode

# 롤아웃 상태 확인
kubectl rollout status deployment/playcode-app -n playcode

# 롤백
kubectl rollout undo deployment/playcode-app -n playcode
```

### 8. 리소스 삭제

```bash
# 특정 리소스 삭제
kubectl delete -f k8s/app-deployment.yaml

# 네임스페이스 전체 삭제 (모든 리소스 삭제)
kubectl delete namespace playcode
```

---

## AWS EKS 배포

### 1. AWS CLI 설치

```bash
# Windows (Chocolatey)
choco install awscli

# Mac (Homebrew)
brew install awscli

# 설치 확인
aws --version
```

### 2. AWS 자격증명 설정

```bash
aws configure
# AWS Access Key ID: <your-access-key>
# AWS Secret Access Key: <your-secret-key>
# Default region: ap-northeast-2
# Default output format: json
```

### 3. eksctl 설치

```bash
# Windows (Chocolatey)
choco install eksctl

# Mac (Homebrew)
brew install eksctl

# 설치 확인
eksctl version
```

### 4. EKS 클러스터 생성

```bash
# 클러스터 생성 (약 15-20분 소요)
eksctl create cluster \
  --name playcode-cluster \
  --region ap-northeast-2 \
  --nodegroup-name playcode-nodes \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 2 \
  --nodes-max 4 \
  --managed
```

### 5. kubectl 설정

```bash
# EKS 클러스터에 연결
aws eks update-kubeconfig --region ap-northeast-2 --name playcode-cluster

# 연결 확인
kubectl get nodes
```

### 6. Docker 이미지 빌드 및 푸시

#### ECR (Amazon Elastic Container Registry) 사용

```bash
# ECR 리포지토리 생성
aws ecr create-repository --repository-name playcode-app --region ap-northeast-2

# Docker 로그인
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <aws-account-id>.dkr.ecr.ap-northeast-2.amazonaws.com

# 이미지 빌드
docker build -t playcode-app:latest .

# 이미지 태그
docker tag playcode-app:latest <aws-account-id>.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:latest

# 이미지 푸시
docker push <aws-account-id>.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:latest
```

### 7. 매니페스트 파일 수정

`k8s/app-deployment.yaml` 파일에서 이미지를 ECR 이미지로 변경:

```yaml
image: <aws-account-id>.dkr.ecr.ap-northeast-2.amazonaws.com/playcode-app:latest
imagePullPolicy: Always
```

### 8. AWS Load Balancer Controller 설치 (Ingress 사용 시)

```bash
# IAM 정책 생성
curl -o iam_policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.0/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json

# OIDC 프로바이더 생성
eksctl utils associate-iam-oidc-provider \
  --region ap-northeast-2 \
  --cluster playcode-cluster \
  --approve

# IAM 서비스 어카운트 생성
eksctl create iamserviceaccount \
  --cluster=playcode-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::<aws-account-id>:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Helm 설치
brew install helm  # Mac
choco install kubernetes-helm  # Windows

# Load Balancer Controller 설치
helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=playcode-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

### 9. 배포

로컬 쿠버네티스와 동일하게 배포:

```bash
kubectl apply -f k8s/
```

### 10. 외부 접속 확인

```bash
# LoadBalancer의 외부 URL 확인
kubectl get svc playcode-app-service -n playcode

# Ingress 사용 시
kubectl get ingress -n playcode
```

### 11. 도메인 연결

Route 53에서 LoadBalancer의 DNS를 도메인에 연결합니다.

---

## 트러블슈팅

### Pod가 시작되지 않을 때

```bash
# Pod 상태 확인
kubectl describe pod <pod-name> -n playcode

# Pod 로그 확인
kubectl logs <pod-name> -n playcode

# 이전 Pod 로그 확인 (재시작된 경우)
kubectl logs <pod-name> -n playcode --previous
```

### 이미지 풀 에러

```bash
# ImagePullBackOff 에러 시
# 1. 이미지 이름 확인
kubectl describe pod <pod-name> -n playcode

# 2. 로컬 이미지 사용 시 imagePullPolicy: Never 설정
# 3. ECR 사용 시 IAM 권한 확인
```

### MongoDB/Redis 연결 실패

```bash
# MongoDB Service 확인
kubectl get svc mongodb-service -n playcode

# MongoDB Pod 로그 확인
kubectl logs <mongodb-pod-name> -n playcode

# 연결 테스트
kubectl run -it --rm debug --image=mongo:7 --restart=Never -n playcode -- mongosh mongodb://admin:password123@mongodb-service:27017/userdb?authSource=admin
```

### 리소스 부족

```bash
# 노드 리소스 확인
kubectl top nodes

# Pod 리소스 확인
kubectl top pods -n playcode

# HPA 상태 확인
kubectl get hpa -n playcode
```

### ConfigMap/Secret 확인

```bash
# ConfigMap 확인
kubectl get configmap playcode-config -n playcode -o yaml

# Secret 확인 (base64 인코딩됨)
kubectl get secret playcode-secrets -n playcode -o yaml

# Secret 디코딩
kubectl get secret playcode-secrets -n playcode -o jsonpath='{.data.JWT_SECRET}' | base64 -d
```

---

## 유용한 명령어

```bash
# 모든 네임스페이스의 Pod 확인
kubectl get pods --all-namespaces

# 특정 Pod에 접속
kubectl exec -it <pod-name> -n playcode -- /bin/sh

# 특정 Pod의 특정 컨테이너 접속
kubectl exec -it <pod-name> -n playcode -c <container-name> -- /bin/sh

# 포트 포워딩
kubectl port-forward pod/<pod-name> 3000:3000 -n playcode

# ConfigMap 업데이트 후 Pod 재시작
kubectl rollout restart deployment/playcode-app -n playcode

# 이벤트 확인
kubectl get events -n playcode --sort-by='.lastTimestamp'

# 리소스 사용량 모니터링
kubectl top nodes
kubectl top pods -n playcode
```

---

## 참고 자료

- [Kubernetes 공식 문서](https://kubernetes.io/docs/home/)
- [AWS EKS 문서](https://docs.aws.amazon.com/eks/)
- [Docker 공식 문서](https://docs.docker.com/)
- [kubectl 치트시트](https://kubernetes.io/docs/reference/kubectl/cheatsheet/)
