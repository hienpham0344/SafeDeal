package com.safedeal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SafeDealApplication {

    public static void main(String[] args) {
        SpringApplication.run(SafeDealApplication.class, args);
    }
}
