FROM eclipse-temurin:21-jre-noble

WORKDIR /app

# Build stage: compile and package
FROM eclipse-temurin:21-jdk-noble AS builder
WORKDIR /workspace
COPY . .
RUN ./mvnw clean package -DskipTests -q

# Runtime stage
FROM eclipse-temurin:21-jre-noble
WORKDIR /app
COPY --from=builder /workspace/target/safedeal-api-0.1.0-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
