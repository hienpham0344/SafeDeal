package com.safedeal;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class ModuleBoundaryArchTest {

    private final JavaClasses classes = new ClassFileImporter()
        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
        .importPackages("com.safedeal");

    @Test
    void domainLayerDoesNotDependOnOuterLayersOrFrameworks() {
        noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "..application..",
                "..infrastructure..",
                "..presentation..",
                "org.springframework..",
                "jakarta.persistence..",
                "org.web3j.."
            )
            .check(classes);
    }

    @Test
    void applicationLayerDoesNotDependOnInfrastructureOrPresentation() {
        noClasses()
            .that().resideInAPackage("..application..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "..infrastructure..",
                "..presentation.."
            )
            .check(classes);
    }

    @Test
    void presentationLayerDoesNotDependOnInfrastructure() {
        noClasses()
            .that().resideInAPackage("..presentation..")
            .should().dependOnClassesThat().resideInAnyPackage(
                "..infrastructure.."
            )
            .check(classes);
    }
}
