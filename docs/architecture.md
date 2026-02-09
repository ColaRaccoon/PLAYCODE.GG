# PlayCode.gg 인프라 아키텍처

## 전체 인프라 구조

```mermaid
graph TB
    subgraph "사용자"
        USER[브라우저/클라이언트]
    end

    subgraph "DNS & CDN"
        DNS[Route 53<br/>playcode.gg]
    end

    subgraph "AWS VPC (10.0.0.0/16)"
        subgraph "Public Subnet"
            NAT[NAT Gateway]
        end

        subgraph "EKS Cluster"
            subgraph "ingress-nginx namespace"
                INGRESS[NGINX Ingress Controller<br/>+ Let's Encrypt TLS]
            end

            subgraph "playcode namespace"
                subgraph "Application"
                    APP1[playcode-app Pod 1<br/>Node.js]
                    APP2[playcode-app Pod 2<br/>Node.js]
                    HPA[HPA<br/>min:2 / max:4<br/>CPU 70% / Mem 80%]
                end

                subgraph "Database"
                    MONGO[(MongoDB 7<br/>StatefulSet<br/>PVC 10Gi)]
                    REDIS[(Redis 7<br/>AOF 영속성<br/>PVC 2Gi)]
                end

                subgraph "Exporters"
                    MONGO_EXP[MongoDB Exporter]
                    REDIS_EXP[Redis Exporter]
                end

                BACKUP[MongoDB Backup<br/>CronJob 매일 3AM KST]
            end

            subgraph "monitoring namespace"
                PROM[Prometheus<br/>메트릭 수집 15s]
                GRAFANA[Grafana<br/>대시보드 3개]
                LOKI[Loki<br/>로그 수집]
                PROMTAIL[Promtail<br/>DaemonSet]
            end
        end
    end

    subgraph "AWS Services"
        ECR[ECR<br/>컨테이너 레지스트리]
        S3_UPLOAD[S3<br/>이미지 업로드]
        S3_BACKUP[S3<br/>DB 백업]
        S3_TF[S3<br/>Terraform State]
        SES[SES<br/>이메일 발송]
    end

    subgraph "CI/CD"
        GH[GitHub<br/>main 브랜치]
        GHA[GitHub Actions<br/>4단계 파이프라인]
    end

    subgraph "External OAuth"
        NAVER[네이버 OAuth]
        GOOGLE[구글 OAuth]
    end

    USER -->|HTTPS| DNS
    DNS --> INGRESS
    INGRESS -->|HTTP :3000| APP1
    INGRESS -->|HTTP :3000| APP2
    HPA -.->|오토스케일링| APP1
    HPA -.->|오토스케일링| APP2

    APP1 & APP2 -->|TCP :27017| MONGO
    APP1 & APP2 -->|TCP :6379| REDIS
    APP1 & APP2 -->|WebSocket| REDIS
    APP1 & APP2 -->|Presigned URL| S3_UPLOAD
    APP1 & APP2 -->|SMTP| SES
    APP1 & APP2 -->|OAuth 2.0| NAVER & GOOGLE

    MONGO_EXP -->|:27017| MONGO
    REDIS_EXP -->|:6379| REDIS
    BACKUP -->|mongodump| MONGO
    BACKUP -->|업로드| S3_BACKUP

    PROM -->|/metrics :3000| APP1 & APP2
    PROM -->|:9216| MONGO_EXP
    PROM -->|:9121| REDIS_EXP
    GRAFANA -->|쿼리| PROM
    GRAFANA -->|쿼리| LOKI
    PROMTAIL -->|로그 수집| LOKI

    GH -->|push main| GHA
    GHA -->|빌드+푸시| ECR
    GHA -->|SSH 배포| APP1 & APP2

    style APP1 fill:#4CAF50,color:#fff
    style APP2 fill:#4CAF50,color:#fff
    style MONGO fill:#47A248,color:#fff
    style REDIS fill:#DC382D,color:#fff
    style PROM fill:#E6522C,color:#fff
    style GRAFANA fill:#F46800,color:#fff
    style LOKI fill:#F46800,color:#fff
```

## CI/CD 파이프라인

```mermaid
flowchart LR
    subgraph "1. Lint"
        L1[Checkout]
        L2[npm ci]
        L3[kubeval<br/>K8s 매니페스트 검증]
    end

    subgraph "2. Security"
        S1[Trivy<br/>파일시스템 스캔]
        S2[CRITICAL/HIGH<br/>취약점 차단]
    end

    subgraph "3. Build"
        B1[GitHub OIDC<br/>AWS 인증]
        B2[Docker Build<br/>멀티스테이지]
        B3[ECR Push<br/>SHA 태그]
        B4[Trivy<br/>이미지 스캔]
    end

    subgraph "4. Deploy"
        D1[승인 게이트<br/>production 환경]
        D2[kubectl set image]
        D3{rollout<br/>status?}
        D4[배포 완료]
        D5[자동 롤백<br/>rollout undo]
    end

    L1 --> L2 --> L3 --> S1 --> S2 --> B1 --> B2 --> B3 --> B4 --> D1 --> D2 --> D3
    D3 -->|성공| D4
    D3 -->|실패| D5

    style D4 fill:#4CAF50,color:#fff
    style D5 fill:#f44336,color:#fff
```

## 네트워크 정책 (제로트러스트)

```mermaid
flowchart TD
    subgraph "playcode namespace"
        direction TB
        APP[playcode-app]
        MONGO[(MongoDB)]
        REDIS[(Redis)]
        ME[MongoDB Exporter]
        RE[Redis Exporter]
    end

    subgraph "ingress-nginx namespace"
        ING[Ingress Controller]
    end

    subgraph "monitoring namespace"
        PROM[Prometheus]
    end

    subgraph "외부"
        EXT[외부 HTTPS<br/>OAuth, S3, SES]
    end

    ING -->|:3000 허용| APP
    APP -->|:27017 허용| MONGO
    APP -->|:6379 허용| REDIS
    APP -->|:443 허용| EXT
    ME -->|:27017 허용| MONGO
    RE -->|:6379 허용| REDIS
    PROM -->|:3000 허용| APP
    PROM -->|:9216 허용| ME
    PROM -->|:9121 허용| RE

    style APP fill:#4CAF50,color:#fff
    style MONGO fill:#47A248,color:#fff
    style REDIS fill:#DC382D,color:#fff
```

## Terraform 모듈 구조

```mermaid
graph TB
    subgraph "terraform/environments/prod"
        MAIN[main.tf<br/>모듈 조합]
        VARS[variables.tf]
        BACKEND[backend.tf<br/>S3 + DynamoDB]
    end

    subgraph "terraform/modules"
        VPC[modules/vpc<br/>VPC + Subnets + NAT]
        EKS[modules/eks<br/>EKS + Node Groups + Addons]
        ECR[modules/ecr<br/>ECR + Lifecycle Policy]
        IAM[modules/iam<br/>OIDC + IRSA + Roles]
    end

    MAIN --> VPC
    MAIN --> EKS
    MAIN --> ECR
    MAIN --> IAM

    VPC -->|vpc_id, subnets| EKS
    ECR -->|repository_arn| IAM
    EKS -->|oidc_provider_arn| IAM

    style MAIN fill:#7B42BC,color:#fff
    style VPC fill:#4285F4,color:#fff
    style EKS fill:#FF9900,color:#fff
    style ECR fill:#FF9900,color:#fff
    style IAM fill:#FF9900,color:#fff
```

## 모니터링 대시보드

| 대시보드 | 주요 메트릭 |
|---------|------------|
| **Application** | HTTP 처리율, 응답 지연시간 (p50/p95/p99), WebSocket 연결 수, 게임 세션/플레이어 수, 인증 시도, Node.js 힙/이벤트루프 |
| **Infrastructure** | Pod CPU/메모리, 재시작 횟수, HPA 레플리카, 네트워크 I/O, 디스크 사용량, 노드 리소스 |
| **Database** | MongoDB 연결/작업율/메모리/스토리지, Redis 메모리/연결/명령율/히트율, 앱 쿼리 지연시간 |
