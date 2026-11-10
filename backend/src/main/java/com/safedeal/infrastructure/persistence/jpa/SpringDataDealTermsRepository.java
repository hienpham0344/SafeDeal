package com.safedeal.infrastructure.persistence.jpa;

import com.safedeal.infrastructure.persistence.entity.JpaDealTermsEntity;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataDealTermsRepository extends JpaRepository<JpaDealTermsEntity, Long> {
    Optional<JpaDealTermsEntity> findByDealId(Long dealId);

    List<JpaDealTermsEntity> findByDealIdIn(Collection<Long> dealIds);
}
